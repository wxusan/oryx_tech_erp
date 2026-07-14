import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function read(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8')
}

describe('due-today/overdue authoritative contract', () => {
  const summaryRoute = read('src/app/api/stats/due-overdue/route.ts')
  const listRoute = read('src/app/api/receivables/route.ts')
  const auth = read('src/lib/api-auth.ts')
  const queries = read('src/lib/server/shop-stats-queries.ts')
  const syncRoute = read('src/app/api/sync/route.ts')

  it('uses exact receivables and action capabilities to select each contract source', () => {
    expect(summaryRoute).toContain('requireReceivableView()')
    expect(listRoute).toContain('requireReceivableView()')
    expect(auth).toContain("principalHasFeature(guarded.principal, 'CASH_SALES')")
    expect(auth).toContain("['RECEIVABLES_VIEW', 'SALE_VIEW', 'SALE_PAYMENT_RECEIVE']")
    expect(auth).toContain("principalHasFeature(guarded.principal, 'NASIYA')")
    expect(auth).toContain("['RECEIVABLES_VIEW', 'NASIYA_VIEW', 'NASIYA_PAYMENT_RECEIVE', 'NASIYA_DEFER']")
    expect(summaryRoute).not.toContain("'PAYMENT_RECEIVE'")
    expect(listRoute).not.toContain("'PAYMENT_RECEIVE'")
    expect(syncRoute).toContain("], ['overdue'])")
  })

  it('uses disjoint Tashkent-midnight predicates and makes today overdue only tomorrow', () => {
    // Cohorts are assigned before contract aggregation: a separate schedule
    // due today must not inherit the contract's overdue label.
    expect(queries).toContain("WHEN coalesce(s.\"delayedUntil\", s.\"dueDate\") < ${input.todayStart} THEN 'OVERDUE'::text")
    expect(queries).toContain("WHEN coalesce(s.\"delayedUntil\", s.\"dueDate\") < ${input.tomorrowStart} THEN 'DUE_TODAY'::text")
    expect(queries).toContain('GROUP BY cohort, deal_id, customer_id, customer_name, customer_phone, device_id, device_model, currency')
    expect(queries).not.toContain('bool_or(effective_due < ${input.todayStart})')
    expect(queries).toContain('A Nasiya obligation is a schedule, not the whole contract')
    expect(queries).toContain("WHEN s.\"dueDate\" < ${input.todayStart} THEN 'OVERDUE'::text")
  })

  it('shares the exact receivable CTE between summary and destination list', () => {
    expect(queries).toContain('function receivableDealsCte(')
    expect(queries.split('${receivableDealsCte(input)}')).toHaveLength(3)
    expect(summaryRoute).toContain('getReceivableCohortSummaries({')
    expect(listRoute).toContain('getReceivableCohortPage({')
    expect(queries).toContain("n.\"resolutionState\" = 'ACTIVE'")
  })

  it('counts customers and deals separately and preserves native UZS/USD totals', () => {
    expect(queries).toContain('count(*)::integer AS deal_count')
    expect(queries).toContain('count(DISTINCT customer_id)::integer AS customer_count')
    expect(queries).toContain("sum(outstanding) FILTER (WHERE currency = 'UZS')")
    expect(queries).toContain("sum(outstanding) FILTER (WHERE currency = 'USD')")
    expect(queries).toContain("deal_type = 'sale' AND currency = 'UZS'")
    expect(queries).toContain("deal_type = 'nasiya' AND currency = 'USD'")
  })
})

describe('global payment banners and exact destination UX', () => {
  const banner = read('src/components/shop/due-overdue-banner.tsx')
  const shell = read('src/app/(shop)/shop-layout-client.tsx')
  const page = read('src/app/(shop)/shop/tolovlar/receivables-client.tsx')

  it('renders overdue first and due-today second into the capability-safe consolidated queue', () => {
    expect(banner.indexOf('summary.overdue.dealCount > 0')).toBeLessThan(banner.indexOf('summary.dueToday.dealCount > 0'))
    expect(banner).toContain('const href = `/shop/tolovlar?cohort=${cohort}`')
    expect(banner).toContain('summary.sources.sale')
    expect(banner).toContain('summary.sources.nasiya')
    expect(banner).not.toContain('/shop/qurilmalar?tab=qarz')
  })

  it('uses the two-minute scoped React Query cache and mutation deltas without fallback polling', () => {
    expect(banner).toContain("queryKeys.list(scope, 'overdue', { view: 'summary' })")
    expect(banner).toContain('queryClient.invalidateQueries({ queryKey })')
    expect(banner).toContain('FINANCIAL_DATA_CHANGED_EVENT')
    expect(banner).not.toContain('setInterval')
    expect(banner).not.toContain('router.refresh')
  })

  it('is visible to exact receivable/action capabilities and stays outside main scroll content', () => {
    expect(shell).toContain('canSeeReceivables')
    expect(shell).toContain("'RECEIVABLES_VIEW'")
    expect(shell).toContain("'SALE_PAYMENT_RECEIVE'")
    expect(shell).toContain("'NASIYA_DEFER'")
    expect(shell).not.toContain("principalCan(principal, 'PAYMENT_RECEIVE')")
    expect(shell).toContain('<DueOverdueBanner initialData={initialDueSummary} />')
    const bannerIndex = shell.indexOf('<DueOverdueBanner')
    expect(bannerIndex).toBeGreaterThan(-1)
    expect(bannerIndex).toBeLessThan(shell.indexOf('<main'))
    expect(shell).toContain('sticky top-0 z-40')
    expect(banner).toContain('sticky top-14 z-30')
  })

  it('keeps the consolidated mixed queue, with direct accessible Sale/Nasiya detail links', () => {
    expect(page).toContain('hidden overflow-hidden')
    expect(page).toContain('md:hidden')
    expect(page).toContain("item.dealType === 'nasiya'")
    expect(page).toContain('`/shop/qurilmalar/${item.deviceId}`')
    expect(page).toContain('data.total > data.take')
    expect(page).toContain('<StretchedLink')
    expect(page).not.toContain("Ko'rish")
  })
})
