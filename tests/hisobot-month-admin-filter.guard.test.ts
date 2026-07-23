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

  it('adminId filters only genuinely admin-attributable flows, including payment-basis profit by collector', () => {
    const queries = read('src/lib/server/shop-stats-queries.ts')
    const occurrences = source.split('...attributedTo').length - 1
    expect(occurrences).toBe(4)
    expect(source).toContain('getShopMonthlyAccountingAggregate({ shopId, monthStart, monthEnd, adminId })')
    expect(queries).toContain('Prisma.sql`AND p."createdBy" = ${input.adminId}`')
    expect(queries).toContain('JOIN "NasiyaPayment" p ON p.id = a."nasiyaPaymentId"')
    expect(source).toContain("...(adminId ? { actorId: adminId } : {})")
  })

  it('current-state fields (device stock value, active nasiyalar, outstanding schedules) are never admin-filtered — explicitly documented, not faked', () => {
    expect(source).toContain('nonAttributableFields')
    expect(source).toContain("'totalDevices', 'activeNasiyalar', 'inventoryPurchaseCost', 'expectedThisMonth', 'overdueMoney', 'upcomingPayments'")
  })

  it('the cache key includes month + admin so filtered views never collide with the default cache entry', () => {
    expect(source).toContain("['shop-stats:v6-realized-profit-only', shopId, role, monthKey ?? 'current', adminId ?? 'all']")
  })
})

describe('hisobot page: month selector + admin filter UI', () => {
  const page = read('src/app/(shop)/shop/hisobot/page.tsx')
  const client = read('src/app/(shop)/shop/hisobot/hisobot-client.tsx')
  const filters = read('src/app/(shop)/shop/hisobot/hisobot-filters.tsx')
  const rangeQuery = read('src/lib/server/shop-report-range.ts')
  const exportRoute = read('src/app/api/export/[entity]/route.ts')

  it('parses month/admin from searchParams and passes them through to getShopStats', () => {
    expect(page).toContain('getShopStats(guarded.session, guarded.shopId, { monthKey, adminId })')
  })

  it('single-month options come from real data, while explicit ranges use the shared bounded resolver', () => {
    expect(page).toContain('getShopReportDataMonths(guarded.shopId)')
    expect(page).toContain('resolveReportRange({')
    expect(page).toContain("availableMonths[0] ?? tashkentMonthRange().monthKey")
    expect(page).not.toContain('recentTashkentMonthKeys(12)')
    expect(filters).toContain('<SelectItem value="trailing3">')
    expect(filters).toContain('<SelectItem value="trailing6">')
    expect(filters).toContain('<SelectItem value="trailing12">')
    expect(filters).toContain('<SelectItem value="custom">')
  })

  it('the month label is parsed from the YYYY-MM key directly, never a Date\'s local-timezone getters', () => {
    expect(page).toContain('function uzMonthLabelFromKey(monthKey: string)')
    expect(page).not.toContain('date.getMonth()')
  })

  it('shows an explicit non-attribution note when an admin filter is active', () => {
    expect(client).toContain('{adminId && (')
    expect(client).toContain("to'lovni yozgan xodimga")
    expect(client).toContain("do'kon bo'yicha ko'rsatiladi")
  })

  it('puts the complete range/admin contract in both the URL and React Query key', () => {
    expect(filters).toContain('router.push(`${pathname}?${params.toString()}`)')
    expect(client).toContain("view: 'hisobot-range'")
    expect(client).toContain('startMonth,')
    expect(client).toContain('endMonth,')
    expect(client).toContain('adminId,')
  })

  it('uses one set-based SQL range statement and preserves native currency partitions', () => {
    expect(rangeQuery).toContain('WITH months AS (')
    expect(rangeQuery).toContain('WITH ORDINALITY')
    expect(rangeQuery).toContain("FILTER (WHERE currency = 'UZS')")
    expect(rangeQuery).toContain("FILTER (WHERE currency = 'USD')")
    expect(rangeQuery).toContain('contract_months AS')
    expect(rangeQuery).toContain('AND n."isImported" = false')
    expect(rangeQuery).toContain('n."accountingReconstructionStatus" IN (\'COMPLETE\', \'PARTIAL\')')
    expect(rangeQuery).toContain('n."resolutionState" = \'ACTIVE\'')
  })

  it('exports the identical URL range/admin contract with separate UZS and USD columns', () => {
    expect(client).toContain('/api/export/report?')
    expect(exportRoute).toContain("report-${range.startMonth}-${range.endMonth}")
    expect(exportRoute).toContain("'cashCollectedUzs'")
    expect(exportRoute).toContain("'cashCollectedUsd'")
    expect(exportRoute).toContain("'contractsUzs'")
    expect(exportRoute).toContain("'contractsUsd'")
    expect(exportRoute).toContain("'expectedReceivablesUzs'")
    expect(exportRoute).toContain("'expectedReceivablesUsd'")
    expect(exportRoute).toContain("report: 'EXPORT_REPORTS'")
    expect(exportRoute).toContain('const guarded = await requireShopPermission(permission)')
  })
})
