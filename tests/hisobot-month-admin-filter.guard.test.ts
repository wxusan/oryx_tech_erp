import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

/**
 * Item 8 — hisobot month + admin filter. The month-boundary math is
 * unit-tested directly in tests/timezone.test.ts (tashkentMonthRangeFromKey /
 * recentTashkentMonthKeys). These guard tests confirm it's actually wired
 * through the stats layer and the page, and that the current-month default
 * (no filter) stays byte-identical for every existing caller.
 */
describe('getShopStats: month/admin filter is additive, existing callers unaffected', () => {
  const source = read('src/lib/server/shop-stats.ts')

  it('options default to no filter (current month, all admins)', () => {
    expect(source).toContain('export async function getShopStats(session: Session, shopId: string, options: ShopStatsOptions = {})')
  })

  it('dashboard and /api/stats/shop call it with no options, so they get the current-month/all-admins snapshot unchanged', () => {
    const dashboard = read('src/app/(shop)/shop/dashboard/page.tsx')
    const statsRoute = read('src/app/api/stats/shop/route.ts')
    expect(dashboard).toContain('getShopStats(guarded.session, guarded.shopId)')
    expect(statsRoute).toContain('getShopStats(')
    expect(statsRoute).not.toContain('monthKey:')
  })

  it('adminId filters only genuinely admin-attributable queries (Sale/SalePayment/Nasiya/NasiyaPayment/DeviceReturn createdBy, Log actorId)', () => {
    const occurrences = source.split('...attributedTo').length - 1
    expect(occurrences).toBe(6)
    expect(source).toContain("...(adminId ? { actorId: adminId } : {})")
  })

  it('current-state fields (device stock value, active nasiyalar, outstanding schedules) are never admin-filtered — explicitly documented, not faked', () => {
    expect(source).toContain('nonAttributableFields')
    expect(source).toContain("'totalDevices', 'activeNasiyalar', 'inventoryPurchaseCost', 'expectedThisMonth', 'overdueMoney', 'upcomingPayments'")
  })

  it('the cache key includes month + admin so filtered views never collide with the default cache entry', () => {
    expect(source).toContain("['shop-stats:v2', shopId, role, monthKey ?? 'current', adminId ?? 'all']")
  })
})

describe('hisobot page: month selector + admin filter UI', () => {
  const page = read('src/app/(shop)/shop/hisobot/page.tsx')
  const client = read('src/app/(shop)/shop/hisobot/hisobot-client.tsx')
  const filters = read('src/app/(shop)/shop/hisobot/hisobot-filters.tsx')

  it('parses month/admin from searchParams and passes them through to getShopStats', () => {
    expect(page).toContain('getShopStats(guarded.session, guarded.shopId, { monthKey, adminId })')
  })

  it('an invalid/missing month falls back to the current month rather than crashing', () => {
    expect(page).toContain('tashkentMonthRangeFromKey(monthParam).monthKey')
  })

  it('the month label is parsed from the YYYY-MM key directly, never a Date\'s local-timezone getters', () => {
    expect(page).toContain('function uzMonthLabelFromKey(monthKey: string)')
    expect(page).not.toContain('date.getMonth()')
  })

  it('shows an explicit non-attribution note when an admin filter is active', () => {
    expect(client).toContain('{stats.filteredByAdmin && (')
    expect(client).toContain("bitta adminga bog'lab bo'lmaydi")
  })

  it('the filter UI navigates via query params, not client-only state (so the server component re-fetches)', () => {
    expect(filters).toContain('router.push(`${pathname}?${params.toString()}`)')
  })
})
