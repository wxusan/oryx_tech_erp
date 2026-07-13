import type { AuthenticatedQueryScope } from '@/lib/query-scope'
import type { DeviceStatus } from '@/lib/device-list-contract'

export interface DeviceListQuery {
  search: string
  status: DeviceStatus | 'Barchasi'
  condition?: 'ALL' | 'NEW' | 'USED'
  page: number
  take: number
  sort: 'createdAt-desc'
}

function scopeRoot(scope: AuthenticatedQueryScope) {
  return [
    'oryx',
    scope.role,
    scope.tenantId,
    scope.sessionVersion,
    scope.memberKind,
    scope.authorizationVersion,
    scope.permissionVersion,
  ] as const
}

export const queryKeys = {
  scope: scopeRoot,
  domain(scope: AuthenticatedQueryScope, domain: string) {
    return [...scopeRoot(scope), domain] as const
  },
  list<T extends Record<string, unknown>>(scope: AuthenticatedQueryScope, domain: string, query: T) {
    return [...scopeRoot(scope), domain, 'list', query] as const
  },
  devices: {
    root(scope: AuthenticatedQueryScope) {
      return [...scopeRoot(scope), 'devices'] as const
    },
    lists(scope: AuthenticatedQueryScope) {
      return [...this.root(scope), 'list'] as const
    },
    list(scope: AuthenticatedQueryScope, query: DeviceListQuery) {
      return [...this.lists(scope), query] as const
    },
    detail(scope: AuthenticatedQueryScope, id: string) {
      return [...this.root(scope), 'detail', id] as const
    },
  },
}

export function deviceListQueryFromKey(key: readonly unknown[]): DeviceListQuery | null {
  const value = key.at(-1)
  if (!value || typeof value !== 'object') return null
  const query = value as Partial<DeviceListQuery>
  if (
    typeof query.search !== 'string'
    || typeof query.status !== 'string'
    || typeof query.page !== 'number'
    || typeof query.take !== 'number'
    || query.sort !== 'createdAt-desc'
  ) return null
  return query as DeviceListQuery
}
