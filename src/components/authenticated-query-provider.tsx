'use client'

import { useEffect, useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { AuthenticatedQueryScope } from '@/lib/query-scope'
import { NavigationCacheCoordinator } from '@/components/navigation-cache-coordinator'
import { QueryScopeContext } from '@/components/query-scope-context'
import { entityStructuralSharing } from '@/lib/query-structural-sharing'

export function createAuthenticatedQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 120_000,
        gcTime: 30 * 60_000,
        retry: 1,
        // The delta coordinator owns focus/reconnect freshness. Disabling the
        // library's broad refetch prevents every stale query from reloading at
        // once when a tab becomes visible.
        refetchOnReconnect: false,
        refetchOnWindowFocus: false,
        refetchOnMount: (query) => query.state.isInvalidated ? 'always' : false,
        structuralSharing: entityStructuralSharing,
      },
      mutations: { retry: 0 },
    },
  })
}

export function AuthenticatedQueryProvider({
  children,
  scope,
  initialCursor,
}: {
  children: React.ReactNode
  scope: AuthenticatedQueryScope
  initialCursor: string
}) {
  const [queryClient] = useState(createAuthenticatedQueryClient)

  useEffect(() => () => queryClient.clear(), [queryClient, scope.key])

  return (
    <QueryClientProvider client={queryClient}>
      <QueryScopeContext.Provider value={scope}>
        <NavigationCacheCoordinator scopeKey={scope.key} initialCursor={initialCursor} />
        {children}
      </QueryScopeContext.Provider>
    </QueryClientProvider>
  )
}
