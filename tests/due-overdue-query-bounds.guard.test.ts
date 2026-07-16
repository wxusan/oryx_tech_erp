import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function read(rel: string) {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

const route = read('src/app/api/stats/due-overdue/route.ts')
const queries = read('src/lib/server/shop-stats-queries.ts')

describe('due/overdue summary query bounds', () => {
  it('keeps the route bounded by delegating one shop/day summary query', () => {
    expect(route).toContain('getReceivableCohortSummaries({')
    expect(route).toContain('includeCashSales: guarded.includeCashSales')
    expect(route).toContain('includeNasiya: guarded.includeNasiya')
    expect(route).not.toContain('.findMany(')
    expect(queries).toContain('export async function getReceivableCohortSummaries')
    expect(queries).toContain('prisma.$queryRaw<ReceivableCohortRow[]>')
  })

  it('filters effective nasiya and sale due dates inside PostgreSQL', () => {
    // A Nasiya schedule due today remains due today even if another schedule
    // on the same contract is already overdue. The aggregate is consequently
    // keyed by cohort as well as contract.
    expect(queries).toContain("WHEN coalesce(s.\"delayedUntil\", s.\"dueDate\") < ${input.todayStart} THEN 'OVERDUE'::text")
    expect(queries).toContain("WHEN coalesce(s.\"delayedUntil\", s.\"dueDate\") < ${input.tomorrowStart} THEN 'DUE_TODAY'::text")
    expect(queries).toContain('GROUP BY cohort, deal_id, customer_id, customer_name, customer_phone, device_id, device_model, currency')
    expect(queries).not.toContain('bool_or(effective_due < ${input.todayStart})')
    expect(queries).toContain('AND s."dueDate" < ${input.tomorrowStart}')
  })

  it('applies tenant and open-debt predicates before the UNION/aggregate', () => {
    expect(queries.split('s."shopId" = ${input.shopId}').length - 1).toBeGreaterThanOrEqual(2)
    expect(queries).toContain("s.\"status\" <> 'CANCELLED'")
    expect(queries).toContain('n."returnedAt" IS NULL')
    expect(queries).toContain('s."contractRemainingAmount" > 0')
  })
})
