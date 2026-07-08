/**
 * Pure formula layer for the dashboard/report stats — see
 * docs/audits/dashboard-stat-formulas.md for the business definition of
 * every field below. Deliberately has NO `import 'server-only'` and no
 * Prisma dependency (unlike `src/lib/server/shop-stats.ts`, which fetches
 * the raw rows and calls `computeShopStatsFromRows` here) so the actual
 * arithmetic can be unit-tested directly with synthetic rows, instead of
 * only through source-string guard tests — mirrors the same pure-helper
 * pattern already used by `src/lib/nasiya-contract.ts`.
 */

import { convertUsdToUzs } from '@/lib/currency'
import { contractOutstandingAsUzs, convertContractAmountToUzs } from '@/lib/nasiya-contract'

export interface ShopStatsRows {
  now: Date
  monthStart: Date
  monthEnd: Date
  usdUzsRate: number | null
  totalDevices: number
  /** Every Sale created this month — ACCRUAL basis, regardless of payment status. */
  cashSalesThisMonth: { salePrice: unknown; device: { purchasePrice: unknown } }[]
  /** Sum of SalePayment.amount (legacy UZS) with paidAt this month — CASH basis. */
  saleReceivedSum: unknown
  /** Every Nasiya created this month (excluding imports) — ACCRUAL basis. */
  nasiyaSoldThisMonth: { totalAmount: unknown; interestAmount: unknown; device: { purchasePrice: unknown } }[]
  /** Sum of NasiyaPayment.amount (legacy UZS) with paidAt this month — CASH basis. */
  nasiyaReceivedSum: unknown
  activeNasiyalar: number
  nasiyaSchedulesForStats: {
    dueDate: Date
    delayedUntil: Date | null
    expectedAmount: unknown
    paidAmount: unknown
    contractExpectedAmount: unknown
    contractPaidAmount: unknown
    nasiya: { contractCurrency: 'UZS' | 'USD' }
  }[]
  unpaidSales: { dueDate: Date | null; remainingAmount: unknown; contractCurrency: 'UZS' | 'USD'; contractRemainingAmount: unknown }[]
  inventoryPurchaseCostSum: unknown
  returnRefundSum: unknown
  returnsThisMonth: number
  recentActivity: { id: string; action: string; createdAt: Date; actorId: string }[]
  upcomingPayments: {
    dueDate: Date
    delayedUntil: Date | null
    expectedAmount: unknown
    paidAmount: unknown
    status: string
    contractExpectedAmount: unknown
    contractPaidAmount: unknown
    nasiya: { id: string; contractCurrency: 'UZS' | 'USD'; customer: { name: string }; device: { model: string } }
  }[]
}

export function computeShopStatsFromRows(rows: ShopStatsRows) {
  const {
    now,
    monthStart,
    monthEnd,
    usdUzsRate,
    totalDevices,
    cashSalesThisMonth,
    saleReceivedSum,
    nasiyaSoldThisMonth,
    nasiyaReceivedSum,
    activeNasiyalar,
    nasiyaSchedulesForStats,
    unpaidSales,
    inventoryPurchaseCostSum,
    returnRefundSum,
    returnsThisMonth,
    recentActivity,
    upcomingPayments,
  } = rows

  // CASH basis: what actually changed hands this month (SalePayment/NasiyaPayment
  // rows with paidAt in this month) — see docs/audits/dashboard-stat-formulas.md
  // "Umumiy aylanma" / "Sof tushum". A sale created this month but not yet paid
  // contributes 0 here until a payment is actually recorded, by design.
  const cashReceived = Number(saleReceivedSum ?? 0)
  const nasiyaReceived = Number(nasiyaReceivedSum ?? 0)
  const cashReceivedThisMonth = cashReceived + nasiyaReceived

  // ACCRUAL basis: every deal CREATED this month counts at its full value the
  // instant the sale/nasiya happens, regardless of payment status — matches
  // standard retail practice (margin is realized when goods change hands) and
  // is the same recognition Nasiya already used before Sale existed. See
  // "Sotuv foydasi" / "Sof foyda" in docs/audits/dashboard-stat-formulas.md.
  const soldDeviceCost = cashSalesThisMonth.reduce(
    (sum, sale) => sum + Number(sale.device.purchasePrice),
    0,
  )
  const nasiyaDeviceCost = nasiyaSoldThisMonth.reduce(
    (sum, nasiya) => sum + Number(nasiya.device.purchasePrice),
    0,
  )
  const accrualRevenueThisMonth =
    cashSalesThisMonth.reduce((sum, sale) => sum + Number(sale.salePrice), 0) +
    nasiyaSoldThisMonth.reduce((sum, nasiya) => sum + Number(nasiya.totalAmount), 0)
  const nasiyaInterestThisMonth = nasiyaSoldThisMonth.reduce(
    (sum, nasiya) => sum + Number(nasiya.interestAmount),
    0,
  )
  const accrualGrossProfitThisMonth = accrualRevenueThisMonth - soldDeviceCost - nasiyaDeviceCost
  const cashBasisProfitThisMonth = cashReceivedThisMonth - soldDeviceCost - nasiyaDeviceCost

  // Both Nasiya schedules and Sale must read their own contract-currency
  // balance, converted to UZS via TODAY's rate exactly once (see
  // contractOutstandingAsUzs / convertContractAmountToUzs above) — never the
  // legacy UZS remainingAmount, which for a USD-native sale is the SUM of
  // several payments each converted at whatever rate was live on that
  // payment's own day, and can drift internally from the true contract-
  // currency balance once the rate has moved between payments.
  const scheduleOutstandingUzs = (schedule: {
    contractExpectedAmount: unknown
    contractPaidAmount: unknown
    nasiya: { contractCurrency: 'UZS' | 'USD' }
  }) => contractOutstandingAsUzs(schedule.contractExpectedAmount, schedule.contractPaidAmount, schedule.nasiya.contractCurrency, usdUzsRate)
  const saleRemainingUzs = (sale: { contractCurrency: 'UZS' | 'USD'; contractRemainingAmount: unknown }) =>
    convertContractAmountToUzs(Number(sale.contractRemainingAmount), sale.contractCurrency, usdUzsRate)
  const effectiveDue = (row: { delayedUntil: Date | null; dueDate: Date }) => row.delayedUntil ?? row.dueDate
  const expectedThisMonth =
    nasiyaSchedulesForStats.reduce((sum, schedule) => {
      const due = effectiveDue(schedule)
      if (due < monthStart || due >= monthEnd) return sum
      return sum + scheduleOutstandingUzs(schedule)
    }, 0) +
    unpaidSales.reduce((sum, sale) => {
      if (!sale.dueDate || sale.dueDate < monthStart || sale.dueDate >= monthEnd) return sum
      return sum + saleRemainingUzs(sale)
    }, 0)
  const overdueSchedules = nasiyaSchedulesForStats.filter((schedule) => {
    if (scheduleOutstandingUzs(schedule) <= 0) return false
    return effectiveDue(schedule) < now
  })
  const overdueSales = unpaidSales.filter((sale) => sale.dueDate && sale.dueDate < now)
  const overdueMoney =
    overdueSchedules.reduce((sum, schedule) => sum + scheduleOutstandingUzs(schedule), 0) +
    overdueSales.reduce((sum, sale) => sum + saleRemainingUzs(sale), 0)
  const inventoryPurchaseCost = Number(inventoryPurchaseCostSum ?? 0)
  const returnRefundsThisMonth = Number(returnRefundSum ?? 0)
  const overdueCount = overdueSchedules.length + overdueSales.length

  return {
    totalDevices,
    cashReceivedThisMonth,
    soldThisMonth: cashSalesThisMonth.length,
    activeNasiyalar,
    expectedThisMonth,
    overdueMoney,
    inventoryPurchaseCost,
    realProfitThisMonth: cashBasisProfitThisMonth,
    accrualRevenueThisMonth,
    accrualGrossProfitThisMonth,
    nasiyaInterestThisMonth,
    expectedProfitWithInterestThisMonth: accrualGrossProfitThisMonth + nasiyaInterestThisMonth,
    grossCashInThisMonth: cashReceivedThisMonth,
    cashCollectedThisMonth: cashReceivedThisMonth,
    returnRefundsThisMonth,
    returnsThisMonth,
    netCashFlowThisMonth: cashReceivedThisMonth - returnRefundsThisMonth,
    netCashAfterReturnsThisMonth: cashReceivedThisMonth - returnRefundsThisMonth,
    overdueCount,
    recentActivity,
    upcomingPayments: upcomingPayments
      .slice()
      .sort((left, right) => effectiveDue(left).getTime() - effectiveDue(right).getTime())
      .slice(0, 5)
      .map((payment) => {
        // Both sides convert from the nasiya's own contract currency via
        // today's rate, so the client's expectedAmount - paidAmount still
        // gives the correct current outstanding balance — see
        // contractOutstandingAsUzs above.
        const toUzs = (amount: unknown) =>
          payment.nasiya.contractCurrency === 'USD' && usdUzsRate ? convertUsdToUzs(Number(amount), usdUzsRate) : Number(amount)
        return {
          ...payment,
          expectedAmount: toUzs(payment.contractExpectedAmount),
          paidAmount: toUzs(payment.contractPaidAmount),
        }
      }),
  }
}
