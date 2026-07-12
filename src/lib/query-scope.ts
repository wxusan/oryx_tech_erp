export interface AuthenticatedQueryScope {
  role: 'SHOP_ADMIN' | 'SUPER_ADMIN'
  tenantId: string
  sessionVersion: number
  key: string
}

export function authenticatedQueryScope(user: {
  id: string
  role: string
  shopId?: string | null
  sessionVersion?: number | null
}): AuthenticatedQueryScope {
  const role = user.role === 'SUPER_ADMIN' ? 'SUPER_ADMIN' : 'SHOP_ADMIN'
  const tenantId = role === 'SHOP_ADMIN' ? (user.shopId ?? 'missing') : user.id
  const sessionVersion = user.sessionVersion ?? 0
  return {
    role,
    tenantId,
    sessionVersion,
    key: `${role}:${tenantId}:${sessionVersion}`,
  }
}
