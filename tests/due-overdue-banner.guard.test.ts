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

  it('resolves the shop via the standard session guard, never trusts a client-supplied shopId', () => {
    expect(route).toContain('const guarded = await requireApiSession()')
    expect(route).toContain('resolveActiveShopId(guarded.session, null)')
  })

  it('uses isContractScheduleOverdue (currency-aware), not the legacy UZS-only predicate', () => {
    expect(route).toContain('isContractScheduleOverdue(')
  })

  it('excludes cancelled nasiyas from the overdue count, same as every other overdue surface', () => {
    expect(route).toContain("status: { not: 'CANCELLED' }")
  })

  it('only returns a direct singleDeal link when there is exactly one overdue deal in total', () => {
    expect(route).toContain('if (distinctDealCount === 1)')
  })

  it('sums overdue money by converting each contract-currency balance to UZS the same way shop-stats does', () => {
    expect(route).toContain('contractOutstandingAsUzs(')
    expect(route).toContain('convertContractAmountToUzs(')
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

  it('refreshes periodically rather than only once per full page load (layout persists across client navigation)', () => {
    expect(component).toContain('setInterval(load, 60_000)')
    expect(component).toContain('clearInterval(interval)')
  })
})

describe('shop layout: banner shown on every shop page, not just the dashboard', () => {
  const layout = read('src/app/(shop)/layout.tsx')
  const shell = read('src/app/(shop)/shop-layout-client.tsx')

  it('renders DueOverdueBanner once, outside the page-specific <main> content', () => {
    expect(layout).toContain('<ShopLayoutClient>{children}</ShopLayoutClient>')
    expect(shell).toContain('<DueOverdueBanner />')
    const bannerIndex = shell.indexOf('<DueOverdueBanner />')
    const mainIndex = shell.indexOf('<main')
    expect(bannerIndex).toBeGreaterThan(-1)
    expect(bannerIndex).toBeLessThan(mainIndex)
  })
})
