import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invalidateNavigationQueryDomains } from '@/lib/navigation-query-invalidation'
import { navigationImpactForMutation } from '@/lib/navigation-cache-policy'
import { queryKeys } from '@/lib/query-keys'
import { authenticatedQueryScope } from '@/lib/query-scope'

const scope = authenticatedQueryScope({
  id: 'shop-admin',
  role: 'SHOP_ADMIN',
  shopId: 'shop-a',
  sessionVersion: 1,
})

describe('incremental navigation domain invalidation', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = new QueryClient()
  })

  it('marks only impacted cached domains stale, including inactive pages', async () => {
    const nasiyasKey = queryKeys.domain(scope, 'nasiyas')
    const reportsKey = queryKeys.domain(scope, 'reports')
    const settingsKey = queryKeys.domain(scope, 'settings')
    queryClient.setQueryData(nasiyasKey, { value: 'old nasiya' })
    queryClient.setQueryData(reportsKey, { value: 'old report' })
    queryClient.setQueryData(settingsKey, { value: 'unchanged' })

    await invalidateNavigationQueryDomains(queryClient, scope, ['nasiyas', 'reports', 'nasiyas'])

    expect(queryClient.getQueryState(nasiyasKey)?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(reportsKey)?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(settingsKey)?.isInvalidated).toBe(false)
  })

  it('does not refetch the device domain that canonical upserts patch precisely', async () => {
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    await invalidateNavigationQueryDomains(queryClient, scope, ['devices', 'sales'])
    expect(invalidate).toHaveBeenCalledTimes(1)
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: queryKeys.domain(scope, 'sales'),
      refetchType: 'active',
    })
  })

  it('uses the complete business-mutation impact for related cross-tab caches', async () => {
    const impact = navigationImpactForMutation({
      kind: 'nasiya.paymentRecorded',
      nasiyaId: 'nasiya-a',
      deviceId: 'device-a',
    })
    const nasiyasKey = queryKeys.domain(scope, 'nasiyas')
    const paymentsKey = queryKeys.domain(scope, 'payments')
    const overdueKey = queryKeys.domain(scope, 'overdue')
    const settingsKey = queryKeys.domain(scope, 'settings')
    for (const key of [nasiyasKey, paymentsKey, overdueKey, settingsKey]) {
      queryClient.setQueryData(key, { cached: true })
    }

    await invalidateNavigationQueryDomains(queryClient, scope, impact.domains)

    expect(queryClient.getQueryState(nasiyasKey)?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(paymentsKey)?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(overdueKey)?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(settingsKey)?.isInvalidated).toBe(false)
  })

  it('invalidates customer list, picker, and profile caches through one customers domain', async () => {
    const listKey = queryKeys.list(scope, 'customers', { surface: 'list', requestRevision: 1, page: 1 })
    const pickerKey = queryKeys.list(scope, 'customers', { surface: 'picker', requestRevision: 2 })
    const profileKey = queryKeys.list(scope, 'customers', { surface: 'profile', customerId: 'customer-a' })
    const reportsKey = queryKeys.domain(scope, 'reports')
    for (const key of [listKey, pickerKey, profileKey, reportsKey]) queryClient.setQueryData(key, { cached: true })

    await invalidateNavigationQueryDomains(queryClient, scope, ['customers'])

    expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(pickerKey)?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(profileKey)?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(reportsKey)?.isInvalidated).toBe(false)
  })

  it('invalidates customer metrics after returns and Olib-sotdim customer sales', () => {
    expect(navigationImpactForMutation({ kind: 'return.created' }).domains).toContain('customers')
    expect(navigationImpactForMutation({ kind: 'olibSotdim.created' }).domains).toContain('customers')
    expect(navigationImpactForMutation({ kind: 'olibSotdim.paymentRecorded' }).domains).not.toContain('customers')
  })
})
