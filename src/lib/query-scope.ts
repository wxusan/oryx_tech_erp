export interface AuthenticatedQueryScope {
  role: 'SHOP_ADMIN' | 'SUPER_ADMIN'
  tenantId: string
  sessionVersion: number
  memberKind: 'SUPER_ADMIN' | 'SHOP_OWNER' | 'SHOP_STAFF'
  authorizationVersion: number
  permissionVersion: number
  packageVersionId: string
  key: string
}

export function authenticatedQueryScope(user: {
  id: string
  role: string
  shopId?: string | null
  sessionVersion?: number | null
  memberKind?: 'SHOP_OWNER' | 'SHOP_STAFF' | null
  authorizationVersion?: number | null
  permissionVersion?: number | null
  packageVersionId?: string | null
}): AuthenticatedQueryScope {
  const role = user.role === 'SUPER_ADMIN' ? 'SUPER_ADMIN' : 'SHOP_ADMIN'
  const tenantId = role === 'SHOP_ADMIN' ? (user.shopId ?? 'missing') : user.id
  const sessionVersion = user.sessionVersion ?? 0
  const memberKind = role === 'SUPER_ADMIN' ? 'SUPER_ADMIN' : (user.memberKind ?? 'SHOP_STAFF')
  const authorizationVersion = user.authorizationVersion ?? 0
  const permissionVersion = user.permissionVersion ?? 0
  const packageVersionId = user.packageVersionId ?? 'none'
  return {
    role,
    tenantId,
    sessionVersion,
    memberKind,
    authorizationVersion,
    permissionVersion,
    packageVersionId,
    key: `${role}:${tenantId}:${sessionVersion}:${memberKind}:${authorizationVersion}:${permissionVersion}:${packageVersionId}`,
  }
}
