import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

describe('shop-stats.ts dashboard aggregates use contractOutstandingAsUzs, not the legacy per-row summed total', () => {
  const source = read('src/lib/server/shop-stats.ts')

  it('fetches a single usdUzsRate for the whole batch (best-effort, never throws)', () => {
    expect(source).toContain('const usdUzsRate = await getUsdUzsRate().catch(() => null)')
  })

  it('selects contract fields on both nasiya schedule queries (expectedThisMonth/overdueMoney and upcomingPayments)', () => {
    const occurrences = source.split('contractExpectedAmount: true').length - 1
    expect(occurrences).toBe(2)
    expect(source.split('contractPaidAmount: true').length - 1).toBe(2)
    expect(source.split('contractCurrency: true').length - 1).toBeGreaterThanOrEqual(2)
  })

  it('expectedThisMonth/overdueMoney derive from scheduleOutstandingUzs (contractOutstandingAsUzs), never the legacy expectedAmount/paidAmount fields directly', () => {
    expect(source).toContain('const scheduleOutstandingUzs = (schedule')
    expect(source).toContain('contractOutstandingAsUzs(schedule.contractExpectedAmount, schedule.contractPaidAmount, schedule.nasiya.contractCurrency, usdUzsRate)')
    expect(source).toContain('return sum + scheduleOutstandingUzs(schedule)')
  })

  it('Sale remainingAmount is untouched (Sale has no contract currency yet — genuinely UZS)', () => {
    expect(source).toContain('sum + Number(sale.remainingAmount)')
  })

  it('upcomingPayments converts both expectedAmount and paidAmount from the nasiya\'s own contract currency via today\'s rate', () => {
    const idx = source.indexOf('upcomingPayments: upcomingPayments')
    const block = source.slice(idx, idx + 800)
    expect(block).toContain("payment.nasiya.contractCurrency === 'USD' && usdUzsRate")
    expect(block).toContain('expectedAmount: toUzs(payment.contractExpectedAmount)')
    expect(block).toContain('paidAmount: toUzs(payment.contractPaidAmount)')
  })

  it('creation-time accrual aggregates (accrualRevenueThisMonth, profit) are untouched — legacy UZS snapshot sums remain correct', () => {
    expect(source).toContain('nasiyaSoldThisMonth.reduce((sum, nasiya) => sum + Number(nasiya.totalAmount), 0)')
  })
})
