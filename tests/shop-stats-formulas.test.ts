import { describe, it, expect } from 'vitest'
import { computeShopStatsFromRows, type ShopStatsRows } from '@/lib/shop-stats-formulas'

/**
 * Dashboard/report accounting-consistency fix. See
 * docs/audits/dashboard-stat-formulas.md for the full formula reference.
 *
 * Root cause of "profit changes but Umumiy aylanma doesn't": these are two
 * DIFFERENT, both-correct accounting bases that were never documented as
 * such, so the divergence looked like a bug:
 *   - "Sotuv foydasi" (accrualGrossProfitThisMonth) is ACCRUAL — every sale
 *     CREATED this month counts at full value immediately, matching
 *     standard retail practice (the margin is realized when the device
 *     changes hands) and matching how Nasiya profit was already recognized.
 *   - "Umumiy aylanma" (grossCashInThisMonth / cashReceivedThisMonth) is
 *     CASH — only money that has actually been RECEIVED (a SalePayment/
 *     NasiyaPayment row with paidAt this month) counts, per this ticket's
 *     own explicit recommended formula.
 * For a FULLY PAID cash sale, both bases agree at the moment of sale (the
 * tests below prove this). For a sale created with a partial/zero down
 * payment, profit is recognized immediately (accrual) while turnover only
 * grows once a payment is actually collected (cash) — this is the
 * documented, intentional distinction, not a bug.
 */

const MONTH_START = new Date('2026-07-01T00:00:00.000Z')
const MONTH_END = new Date('2026-08-01T00:00:00.000Z')
const NOW = new Date('2026-07-15T10:00:00.000Z') // inside the month
const LAST_MONTH = new Date('2026-06-15T10:00:00.000Z') // before monthStart

function baseRows(overrides: Partial<ShopStatsRows> = {}): ShopStatsRows {
  return {
    now: NOW,
    monthStart: MONTH_START,
    monthEnd: MONTH_END,
    usdUzsRate: 12_500,
    totalDevices: 0,
    cashSalesThisMonth: [],
    saleReceivedSum: 0,
    nasiyaSoldThisMonth: [],
    nasiyaReceivedSum: 0,
    activeNasiyalar: 0,
    nasiyaSchedulesForStats: [],
    unpaidSales: [],
    inventoryPurchaseCostSum: 0,
    returnRefundSum: 0,
    returnsThisMonth: 0,
    recentActivity: [],
    upcomingPayments: [],
    ...overrides,
  }
}

describe('worked example: a fully-paid cash sale moves profit AND turnover together', () => {
  it('device bought for 5,000,000 so\'m, sold for 6,250,000 so\'m, fully paid immediately this month', () => {
    const stats = computeShopStatsFromRows(
      baseRows({
        cashSalesThisMonth: [{ salePrice: 6_250_000, device: { purchasePrice: 5_000_000 } }],
        // A fully-paid sale creates a SalePayment row for the full amount,
        // dated the same instant — this is what makes cash-basis turnover
        // move in lockstep with accrual profit for this specific case.
        saleReceivedSum: 6_250_000,
      }),
    )
    expect(stats.accrualGrossProfitThisMonth).toBe(1_250_000) // profit: Sotuv foydasi
    expect(stats.grossCashInThisMonth).toBe(6_250_000) // turnover: Umumiy aylanma
    expect(stats.soldThisMonth).toBe(1) // Every Sale row created this month.
  })
})

describe('worked example: a sale created with NO down payment recognizes profit but not turnover (documented, not a bug)', () => {
  it('profit (accrual) increases the instant the sale is created; turnover (cash) stays 0 until a payment exists', () => {
    const stats = computeShopStatsFromRows(
      baseRows({
        cashSalesThisMonth: [{ salePrice: 6_250_000, device: { purchasePrice: 5_000_000 } }],
        // No SalePayment row yet -> saleReceivedSum contributes nothing.
        saleReceivedSum: 0,
      }),
    )
    expect(stats.accrualGrossProfitThisMonth).toBe(1_250_000)
    expect(stats.grossCashInThisMonth).toBe(0)
  })

  it('once a partial payment is later recorded this month, turnover reflects exactly the amount collected, not the full sale price', () => {
    const stats = computeShopStatsFromRows(
      baseRows({
        cashSalesThisMonth: [{ salePrice: 6_250_000, device: { purchasePrice: 5_000_000 } }],
        saleReceivedSum: 2_000_000, // customer paid 2,000,000 so far
      }),
    )
    expect(stats.accrualGrossProfitThisMonth).toBe(1_250_000) // unchanged — full margin already recognized
    expect(stats.grossCashInThisMonth).toBe(2_000_000) // only what was actually collected
  })
})

describe('Sotuvlar (all Sale rows) and Ombordagi tannarx (inventory cost)', () => {
  it('sold-this-month count reflects every Sale row created this month, regardless of payment status', () => {
    const stats = computeShopStatsFromRows(
      baseRows({
        cashSalesThisMonth: [
          { salePrice: 500, device: { purchasePrice: 300 } },
          { salePrice: 800, device: { purchasePrice: 600 } },
        ],
      }),
    )
    expect(stats.soldThisMonth).toBe(2)
  })

  it('inventory purchase cost only sums IN_STOCK devices (a sold device already left this figure by construction of the query)', () => {
    const stats = computeShopStatsFromRows(baseRows({ inventoryPurchaseCostSum: 12_000_000 }))
    expect(stats.inventoryPurchaseCost).toBe(12_000_000)
  })
})

describe('nasiya payments received this month affect turnover, not future unpaid debt', () => {
  it('a nasiya payment received this month adds to cashReceivedThisMonth (Sof tushum), not expectedThisMonth', () => {
    const stats = computeShopStatsFromRows(
      baseRows({
        nasiyaReceivedSum: 1_500_000,
        nasiyaSchedulesForStats: [
          {
            dueDate: new Date('2026-07-20'),
            delayedUntil: null,
            expectedAmount: 2_000_000,
            paidAmount: 0,
            contractExpectedAmount: 2_000_000,
            contractPaidAmount: 0,
            nasiya: { contractCurrency: 'UZS' },
          },
        ],
      }),
    )
    expect(stats.cashReceivedThisMonth).toBe(1_500_000)
    // The unpaid future schedule (due later this month, not yet paid) is
    // expected receivable money, not already-collected cash — it must not
    // be double-counted into cashReceivedThisMonth.
    expect(stats.expectedThisMonth).toBe(2_000_000)
  })

  it('a fully-paid schedule does not inflate expectedThisMonth', () => {
    const stats = computeShopStatsFromRows(
      baseRows({
        nasiyaSchedulesForStats: [
          {
            dueDate: new Date('2026-07-20'),
            delayedUntil: null,
            expectedAmount: 2_000_000,
            paidAmount: 2_000_000,
            contractExpectedAmount: 2_000_000,
            contractPaidAmount: 2_000_000,
            nasiya: { contractCurrency: 'UZS' },
          },
        ],
      }),
    )
    expect(stats.expectedThisMonth).toBe(0)
  })
})

describe('dashboard server/client serialization', () => {
  it('returns upcoming contract amounts as plain numbers instead of ORM decimal objects', () => {
    const stats = computeShopStatsFromRows(baseRows({
      upcomingPayments: [{
        dueDate: new Date('2026-07-20'),
        delayedUntil: null,
        expectedAmount: 75,
        paidAmount: 25,
        contractExpectedAmount: { valueOf: () => 75 },
        contractPaidAmount: { valueOf: () => 25 },
        status: 'PARTIAL',
        nasiya: {
          id: 'nasiya-serialization',
          contractCurrency: 'USD',
          customer: { name: 'Serialization Customer' },
          device: { model: 'Serialization Device' },
        },
      }],
    }))

    expect(stats.upcomingPayments[0]?.contractExpectedAmount).toBe(75)
    expect(stats.upcomingPayments[0]?.contractPaidAmount).toBe(25)
    expect(typeof stats.upcomingPayments[0]?.contractExpectedAmount).toBe('number')
    expect(typeof stats.upcomingPayments[0]?.contractPaidAmount).toBe('number')
  })
})

describe('USD-native sale turnover does not drift after a rate change', () => {
  it('cashReceivedThisMonth reads the frozen SalePayment.amount snapshot, never re-derived from a later rate', () => {
    // A $500 sale paid in full at creation-time rate 12,500 writes a
    // SalePayment.amount of 6,250,000 so'm (frozen). Changing usdUzsRate
    // here (simulating the rate moving later) must not alter the aggregate
    // — it is a straight sum of the already-recorded legacy amounts, not a
    // live reconversion.
    const statsAtOldRate = computeShopStatsFromRows(baseRows({ usdUzsRate: 12_500, saleReceivedSum: 6_250_000 }))
    const statsAtNewRate = computeShopStatsFromRows(baseRows({ usdUzsRate: 13_000, saleReceivedSum: 6_250_000 }))
    expect(statsAtOldRate.cashReceivedThisMonth).toBe(6_250_000)
    expect(statsAtNewRate.cashReceivedThisMonth).toBe(6_250_000)
  })
})

describe('return-period reversal preserves the original sale period', () => {
  it('posts revenue/cost reversal and retained value in the return month', () => {
    const stats = computeShopStatsFromRows(baseRows({
      returnRefundSum: 500,
      returnRevenueReversalSum: 1_000,
      returnInventoryCostRecoverySum: 600,
      returnRetainedValueSum: 200,
      returnsThisMonth: 1,
    }))

    expect(stats.accrualRevenueBeforeReturnsThisMonth).toBe(0)
    expect(stats.accrualRevenueThisMonth).toBe(-800)
    expect(stats.accrualGrossProfitThisMonth).toBe(-200)
    expect(stats.returnRevenueReversalsThisMonth).toBe(1_000)
    expect(stats.returnInventoryCostRecoveriesThisMonth).toBe(600)
    expect(stats.returnRetainedValueThisMonth).toBe(200)
    expect(stats.netCashFlowThisMonth).toBe(-500)
  })

  it('keeps an original-period sale intact when no return event belongs to that month', () => {
    const originalPeriod = computeShopStatsFromRows(baseRows({
      cashSalesThisMonth: [{ salePrice: 1_000, device: { purchasePrice: 600 } }],
      saleReceivedSum: 1_000,
    }))
    expect(originalPeriod.accrualRevenueThisMonth).toBe(1_000)
    expect(originalPeriod.accrualGrossProfitThisMonth).toBe(400)
  })
})

describe('mixed USD/UZS aggregation never raw-sums currencies', () => {
  it('expectedThisMonth converts each USD schedule/sale balance via convertContractAmountToUzs before summing with UZS ones', () => {
    const stats = computeShopStatsFromRows(
      baseRows({
        usdUzsRate: 12_500,
        nasiyaSchedulesForStats: [
          {
            dueDate: new Date('2026-07-20'),
            delayedUntil: null,
            expectedAmount: 0,
            paidAmount: 0,
            contractExpectedAmount: 100, // $100 outstanding
            contractPaidAmount: 0,
            nasiya: { contractCurrency: 'USD' },
          },
        ],
        unpaidSales: [
          {
            dueDate: new Date('2026-07-25'),
            remainingAmount: 0,
            contractCurrency: 'UZS',
            contractRemainingAmount: 500_000, // 500,000 so'm outstanding
          },
        ],
      }),
    )
    // $100 -> 1,250,000 so'm at rate 12,500, plus the 500,000 so'm sale ->
    // 1,750,000 total. Never $100 + 500,000 = 500,100 (a meaningless raw sum).
    expect(stats.expectedThisMonth).toBe(1_250_000 + 500_000)
  })

  it('keeps native partitions when the USD rate is unavailable', () => {
    const stats = computeShopStatsFromRows(
      baseRows({
        usdUzsRate: null,
        nasiyaSchedulesForStats: [{
          dueDate: new Date('2026-07-20'),
          delayedUntil: null,
          expectedAmount: 0,
          paidAmount: 0,
          contractExpectedAmount: 100,
          contractPaidAmount: 0,
          nasiya: { contractCurrency: 'USD' },
        }],
        unpaidSales: [{
          dueDate: new Date('2026-07-25'),
          remainingAmount: 0,
          contractCurrency: 'UZS',
          contractRemainingAmount: 500_000,
        }],
      }),
    )
    expect(stats.expectedThisMonth).toBe(500_000)
    expect(stats.expectedThisMonthUzs).toBe(500_000)
    expect(stats.expectedThisMonthUsd).toBe(100)
    expect(stats.expectedThisMonthComplete).toBe(false)
  })
})

describe('active/overdue exclusions', () => {
  it('activeNasiyalar count is passed through as-is from the ACTIVE/OVERDUE-filtered query (completed nasiyas already excluded by the query itself)', () => {
    const stats = computeShopStatsFromRows(baseRows({ activeNasiyalar: 3 }))
    expect(stats.activeNasiyalar).toBe(3)
  })

  it('a schedule within tolerance (effectively paid) does not count as overdue even if its due date is in the past', () => {
    const stats = computeShopStatsFromRows(
      baseRows({
        nasiyaSchedulesForStats: [
          {
            dueDate: new Date('2020-01-01'), // long past
            delayedUntil: null,
            expectedAmount: 200_000,
            paidAmount: 200_000, // fully paid
            contractExpectedAmount: 200_000,
            contractPaidAmount: 200_000,
            nasiya: { contractCurrency: 'UZS' },
          },
        ],
      }),
    )
    expect(stats.overdueCount).toBe(0)
    expect(stats.overdueMoney).toBe(0)
  })

  it('a genuinely unpaid past-due schedule counts as overdue', () => {
    const stats = computeShopStatsFromRows(
      baseRows({
        nasiyaSchedulesForStats: [
          {
            dueDate: new Date('2020-01-01'),
            delayedUntil: null,
            expectedAmount: 200_000,
            paidAmount: 0,
            contractExpectedAmount: 200_000,
            contractPaidAmount: 0,
            nasiya: { contractCurrency: 'UZS' },
          },
        ],
      }),
    )
    expect(stats.overdueCount).toBe(1)
    expect(stats.overdueMoney).toBe(200_000)
  })
})

describe('regression: dashboard and hisobot read the exact same stats object', () => {
  it('grossCashInThisMonth/cashCollectedThisMonth/cashReceivedThisMonth are always identical (same source field, multiple historical aliases)', () => {
    const stats = computeShopStatsFromRows(baseRows({ saleReceivedSum: 1_000_000, nasiyaReceivedSum: 500_000 }))
    expect(stats.grossCashInThisMonth).toBe(1_500_000)
    expect(stats.cashCollectedThisMonth).toBe(1_500_000)
    expect(stats.cashReceivedThisMonth).toBe(1_500_000)
  })

  it('accrualRevenueThisMonth is exposed (previously computed internally but discarded) for anything that needs true accrual revenue, not just net profit', () => {
    const stats = computeShopStatsFromRows(
      baseRows({ cashSalesThisMonth: [{ salePrice: 6_250_000, device: { purchasePrice: 5_000_000 } }] }),
    )
    expect(stats.accrualRevenueThisMonth).toBe(6_250_000)
  })
})

describe('date-range scoping: only rows within the selected month count for accrual/cash "this month" figures', () => {
  it('a sale created LAST month does not count toward this month\'s accrual profit/turnover (query-level scoping, sanity-checked here with same-shape rows)', () => {
    // computeShopStatsFromRows trusts its caller to have already scoped
    // cashSalesThisMonth/saleReceivedSum to the month via the Prisma
    // `createdAt`/`paidAt` where clause — this test documents that
    // contract: passing an empty array (as the query would for a
    // last-month-only sale) yields zero for both bases.
    const stats = computeShopStatsFromRows(baseRows({ cashSalesThisMonth: [], saleReceivedSum: 0 }))
    expect(stats.accrualGrossProfitThisMonth).toBe(0)
    expect(stats.grossCashInThisMonth).toBe(0)
  })

  it('LAST_MONTH constant is genuinely before MONTH_START (guards the fixture itself against a future typo)', () => {
    expect(LAST_MONTH.getTime()).toBeLessThan(MONTH_START.getTime())
  })
})
