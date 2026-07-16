import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

/**
 * Query-selection code (which fields the Prisma queries fetch) stays in
 * src/lib/server/shop-stats.ts. The actual arithmetic/formulas were
 * extracted into src/lib/shop-stats-formulas.ts (no `server-only`, no
 * Prisma) so they can be unit-tested directly with synthetic rows — see
 * tests/shop-stats-formulas.test.ts. This file checks both halves.
 */
describe('shop stats use bounded set-based native-currency aggregates', () => {
  const source = read('src/lib/server/shop-stats.ts')
  const queries = read('src/lib/server/shop-stats-queries.ts')

  it('fetches a single usdUzsRate for the whole batch (best-effort, never throws)', () => {
    expect(source).toContain('const usdUzsRate = await getUsdUzsRate().catch(() => null)')
  })

  it('delegates expected/overdue totals to getShopObligationAggregate and does not hydrate those full row sets', () => {
    expect(source).toContain('getShopObligationAggregate({ shopId, monthStart, monthEnd, todayStart })')
    expect(source).toContain('nasiyaSchedulesForStats: []')
    expect(source).toContain('unpaidSales: []')
    expect(source).toContain('obligationAggregate,')
  })

  it('partitions expected and overdue balances by native currency inside SQL', () => {
    for (const alias of ['expected_uzs', 'expected_usd', 'overdue_uzs', 'overdue_usd']) {
      expect(queries).toContain(`AS ${alias}`)
    }
    expect(queries).not.toContain('s."contractExpectedAmount" - s."contractPaidAmount"')
    expect(queries).toContain('s."contractRemainingAmount" AS outstanding')
    expect(queries).toContain("WHERE currency = 'UZS'")
    expect(queries).toContain("WHERE currency = 'USD'")
  })

  it('bounds the upcoming-payment detail hydration to IDs selected with a SQL LIMIT', () => {
    expect(source).toContain('getUpcomingScheduleIds(shopId, 5)')
    expect(source.split('contractExpectedAmount: true').length - 1).toBe(1)
    expect(source.split('contractPaidAmount: true').length - 1).toBe(1)
    expect(source.split('contractRemainingAmount: true').length - 1).toBe(1)
    expect(queries).toContain('LIMIT ${Math.max(1, Math.min(Math.trunc(take), 50))}')
  })

  it('passes set-based and scalar aggregates through to the pure formula layer', () => {
    expect(source).toContain('const computed = computeShopStatsFromRows({')
    expect(source).toContain('monthlyAccountingAggregate,')
    expect(source).toContain('obligationAggregate,')
    expect(source).toContain('saleReceivedSum: saleReceivedAgg._sum.amount')
    expect(source).toContain('nasiyaReceivedSum: nasiyaReceivedAgg._sum.amount')
  })
})

describe('shop-stats-formulas.ts consumes native partitions without mixing currencies', () => {
  const source = read('src/lib/shop-stats-formulas.ts')
  const queries = read('src/lib/server/shop-stats-queries.ts')

  it('uses the SQL obligation aggregate for production and retains row iteration only as a test-compatible fallback', () => {
    expect(source).toContain('const expectedPartition: MoneyPartition = obligationAggregate')
    expect(source).toContain('expectedUzs: unknown')
    expect(source).toContain('expectedUsd: unknown')
    expect(source).toContain('if (!obligationAggregate) {')
    expect(source).toContain('const overduePartition: MoneyPartition = obligationAggregate')
  })

  it('converts the aggregate USD partition once and exposes completeness/native partitions', () => {
    expect(source).toContain("convertContractAmountToUzs(partition.usd, 'USD', usdUzsRate)")
    expect(source).toContain('expectedThisMonthUzs: expectedProfitPartition.uzs')
    expect(source).toContain('expectedThisMonthUsd: expectedProfitPartition.usd')
    expect(source).toContain('expectedReceivablesThisMonthUzs: expectedPartition.uzs')
    expect(source).toContain('expectedReceivablesThisMonthUsd: expectedPartition.usd')
    expect(source).toContain('overdueMoneyUzs: overduePartition.uzs')
    expect(source).toContain('overdueMoneyUsd: overduePartition.usd')
  })

  it('upcomingPayments exposes the authoritative native remaining balance for the client', () => {
    const idx = source.indexOf('upcomingPayments: upcomingPayments')
    const block = source.slice(idx, idx + 1_200)
    expect(block).toContain("payment.nasiya.contractCurrency === 'USD'")
    expect(block).toContain("convertContractAmountToUzs(Number(amount), 'USD', usdUzsRate) ?? 0")
    expect(block).toContain('contractExpectedAmount: Number(payment.contractExpectedAmount)')
    expect(block).toContain('contractPaidAmount: Number(payment.contractPaidAmount)')
    expect(block).toContain('contractRemainingAmount: scheduleOutstandingNative(payment)')
  })

  it('actual profit is set-based on frozen payment/allocation UZS components', () => {
    expect(source).toContain('Number(monthlyAccountingAggregate.actualProfitUzs)')
    expect(queries).toContain('sum(p."marginAmountUzs")')
    expect(queries).toContain('sum(a."marginAmountUzs")')
    expect(queries).toContain('sum(a."interestAmountUzs")')
  })
})
