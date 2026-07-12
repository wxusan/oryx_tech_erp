import type { QueryClient } from '@tanstack/react-query'
import type { AuthenticatedQueryScope } from '@/lib/query-scope'
import { queryKeys } from '@/lib/query-keys'
import type { NavigationDomain } from '@/lib/navigation-cache-policy'

/**
 * Mark only the affected domain caches stale. Device lists are updated from
 * canonical sync upserts/tombstones, so they deliberately avoid a second
 * network refetch here.
 */
export async function invalidateNavigationQueryDomains(
  queryClient: QueryClient,
  scope: AuthenticatedQueryScope,
  domains: readonly NavigationDomain[],
) {
  const uniqueDomains = [...new Set(domains)]
  await Promise.all(uniqueDomains.map((domain) => {
    if (domain === 'devices') return Promise.resolve()
    return queryClient.invalidateQueries({
      queryKey: queryKeys.domain(scope, domain),
      refetchType: 'active',
    })
  }))
}
