'use client'

import { createContext, useContext } from 'react'
import type { AuthenticatedQueryScope } from '@/lib/query-scope'

export const QueryScopeContext = createContext<AuthenticatedQueryScope | null>(null)

export function useAuthenticatedQueryScope() {
  const scope = useContext(QueryScopeContext)
  if (!scope) throw new Error('AuthenticatedQueryProvider is missing')
  return scope
}
