import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

/**
 * Item 10 — persistent portal banner for overdue nasiya/sale payments.
 * Guard tests: the summary endpoint is shop-scoped and money-correct
 * (contract-currency aware, matching every other overdue calculation in
 * this codebase), and the banner itself is wired into the shop layout so
 * it's visible on every page, not just the dashboard.
 */
describe('GET /api/stats/due-overdue: shop-scoped, contract-currency-aware overdue summary', () => {
  const route = read('src/app/api/stats/due-overdue/route.ts')
  const queries = read('src/lib/server/shop-stats-queries.ts')

  it('resolves the shop via the standard session guard, never trusts a client-supplied shopId', () => {
    expect(route).toContain('const guarded = await requireApiSession()')
    expect(route).toContain('resolveActiveShopId(guarded.session, null)')
  })

  it('delegates to the set-based overdue helper instead of hydrating debt rows in the route', () => {
    expect(route).toContain('getCurrentOverdueSummary({ shopId, todayStart: today })')
    expect(route).not.toContain('prisma.nasiyaSchedule.findMany')
    expect(route).not.toContain('prisma.sale.findMany')
    expect(queries).toContain('WITH nasiya_deals AS')
    expect(queries).toContain('UNION ALL')
  })

  it('excludes cancelled nasiyas from the overdue count, same as every other overdue surface', () => {
    expect(queries).toContain(`n."status" <> 'CANCELLED'`)
  })

  it('only returns a direct singleDeal link when there is exactly one overdue deal in total', () => {
    expect(queries).toContain('CASE WHEN count(*) = 1 THEN min(deal_type) END AS single_type')
    expect(queries).toContain('CASE WHEN count(*) = 1 THEN min(deal_id) END AS single_id')
    expect(route).toContain('singleDeal: summary.singleDeal')
  })

  it('keeps native UZS/USD partitions in SQL and converts the aggregated USD partition exactly once', () => {
    expect(queries).toContain("sum(outstanding) FILTER (WHERE currency = 'UZS')")
    expect(queries).toContain("sum(outstanding) FILTER (WHERE currency = 'USD')")
    expect(route).toContain("convertContractAmountToUzs(summary.overdueNativeUsd, 'USD', currency.usdUzsRate)")
    expect(route).toContain('summary.overdueNativeUzs + (convertedUsd ?? 0)')
    expect(route).toContain('overdueMoneyComplete: summary.overdueNativeUsd === 0 || convertedUsd !== null')
  })
})

describe('DueOverdueBanner: persistent, non-spammy, links to the right place', () => {
  const component = read('src/components/shop/due-overdue-banner.tsx')

  it('renders nothing when there is no overdue debt (no empty/false banner flash)', () => {
    expect(component).toContain('if (!summary || summary.overdueDealCount === 0) return null')
  })

  it('has no dismiss button — "persistent until paid" per the ticket', () => {
    expect(component).not.toContain('onDismiss')
    expect(component).not.toContain('setDismissed')
    expect(component).not.toContain("aria-label=\"Yopish\"")
  })

  it('is one summarized banner, not one per overdue deal (no .map over deals)', () => {
    expect(component).not.toMatch(/summary\.(deals|items)\.map/)
  })

  it('links directly to the nasiya profile when there is exactly one overdue deal, otherwise to the filtered list', () => {
    expect(component).toContain('`/shop/nasiyalar/${summary.singleDeal.id}`')
    expect(component).toContain("'/shop/nasiyalar?status=OVERDUE'")
  })

  it('refreshes on money mutations/focus and uses a five-minute fallback instead of 60-second polling', () => {
    expect(component).toContain('const FALLBACK_REFRESH_MS = 5 * 60_000')
    expect(component).toContain("window.addEventListener(FINANCIAL_DATA_CHANGED_EVENT, load)")
    expect(component).toContain("window.addEventListener('focus', refreshWhenVisible)")
    expect(component).toContain('window.setInterval(refreshWhenVisible, FALLBACK_REFRESH_MS)')
    expect(component).not.toContain('setInterval(load, 60_000)')
  })

  it('aborts stale requests and cleans up every persistent listener', () => {
    expect(component).toContain('activeController?.abort()')
    expect(component).toContain("window.removeEventListener(FINANCIAL_DATA_CHANGED_EVENT, load)")
    expect(component).toContain("document.removeEventListener('visibilitychange', refreshWhenVisible)")
  })
})

describe('shop layout: banner shown on every shop page, not just the dashboard', () => {
  const layout = read('src/app/(shop)/layout.tsx')
  const shell = read('src/app/(shop)/shop-layout-client.tsx')

  it('renders DueOverdueBanner once, outside the page-specific <main> content', () => {
    expect(layout).toContain('<ShopLayoutClient')
    expect(layout).toContain('{children}')
    expect(shell).toContain('<DueOverdueBanner />')
    const bannerIndex = shell.indexOf('<DueOverdueBanner />')
    const mainIndex = shell.indexOf('<main')
    expect(bannerIndex).toBeGreaterThan(-1)
    expect(bannerIndex).toBeLessThan(mainIndex)
  })
})
