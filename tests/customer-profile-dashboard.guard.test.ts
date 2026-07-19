import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

describe('customer-profile analytics architecture', () => {
  it('server-seeds overview, analytics, and bounded history in parallel', () => {
    const page = source('src/app/(shop)/shop/mijozlar/[id]/page.tsx')
    expect(page).toContain('const [overview, analytics, history] = await Promise.all([')
    expect(page).toContain('getCustomerProfileAnalytics({')
    expect(page).toContain('getCustomerProfileHistory({')
    expect(page).not.toContain('fetch(')
  })

  it('splits client caches and retains prior chart/history data during refreshes', () => {
    const client = source('src/app/(shop)/shop/mijozlar/[id]/customer-profile-client.tsx')
    expect(client).toContain("surface: 'profile-overview'")
    expect(client).toContain("surface: 'profile-analytics'")
    expect(client).toContain("surface: 'profile-history'")
    expect(client).toContain('initialData: initialOverview')
    expect(client.match(/placeholderData: keepPreviousData/g)).toHaveLength(2)
    expect(client).toContain('staleTime: PROFILE_STALE_TIME_MS')
    expect(client).toContain('queryFn: ({ signal }) => fetchAnalytics(months, signal)')
    expect(client).toContain("markQueryIntent('customer-profile-analytics')")
  })

  it('lazy-loads accessible, non-animated charts with a stable skeleton', () => {
    const loader = source('src/app/(shop)/shop/mijozlar/[id]/customer-profile-charts-loader.tsx')
    const charts = source('src/app/(shop)/shop/mijozlar/[id]/customer-profile-charts.tsx')
    expect(loader).toContain("dynamic(() => import('./customer-profile-charts')")
    expect(loader).toContain('ssr: false')
    expect(loader).toContain('h-[430px]')
    expect(charts).toContain('<BarChart accessibilityLayer')
    expect(charts).toContain('aria-labelledby="customer-activity-chart-title"')
    expect(charts).toContain('aria-labelledby="customer-debt-chart-title"')
    expect(charts).toContain('isAnimationActive={false}')
    expect(charts).toContain('Aniq oylik qiymatlar')
  })

  it('keeps analytics tenant-scoped, range-bounded, and redacted on the server', () => {
    const route = source('src/app/api/customers/[id]/analytics/route.ts')
    const analytics = source('src/lib/server/customer-profile-analytics.ts')
    const visibility = source('src/lib/customer-profile-visibility.ts')
    expect(route).toContain("requireShopPermission('CUSTOMER_VIEW')")
    expect(route).toContain('parseCustomerProfileAnalyticsMonths')
    expect(analytics).toContain('SELECT generate_series(')
    expect(analytics).toContain('${(input.months - 1)}')
    expect(analytics).toContain('customer_scope AS')
    expect(analytics).toContain('AND c."shopId" = ${input.shopId}')
    expect(analytics).toContain('redactShopStaffCustomerProfileAnalytics')
    expect(visibility).toContain('activity: analytics.activity.map(({ month, contracts }) => ({ month, contracts }))')
  })

  it('uses take-plus-one history pagination without an exact-count query', () => {
    const profile = source('src/lib/server/customer-profile.ts')
    expect(profile).toContain('LIMIT ${take + 1}')
    expect(profile).toContain('totalIsExact: false')
    expect(profile).toContain('hasNext')
    expect(profile).not.toContain('COUNT(*) OVER')
  })
})
