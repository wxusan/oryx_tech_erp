export const NAVIGATION_CACHE_TTL_SECONDS = 120
export const NAVIGATION_CACHE_TTL_MS = NAVIGATION_CACHE_TTL_SECONDS * 1_000

export const navigationDomains = [
  'devices',
  'sales',
  'nasiyas',
  'payments',
  'returns',
  'customers',
  'reports',
  'logs',
  'currency',
  'overdue',
  'olibSotdim',
  'settings',
  'access',
  'adminShops',
  'adminPayments',
  'adminReports',
  'adminLogs',
  'adminOps',
] as const

export type NavigationDomain = (typeof navigationDomains)[number]

export type NavigationMutationKind =
  | 'device.created'
  | 'device.updated'
  | 'device.deleted'
  | 'device.restocked'
  | 'sale.created'
  | 'sale.updated'
  | 'sale.paymentRecorded'
  | 'nasiya.created'
  | 'nasiya.imported'
  | 'nasiya.updated'
  | 'nasiya.reminderUpdated'
  | 'nasiya.paymentRecorded'
  | 'return.created'
  | 'olibSotdim.created'
  | 'olibSotdim.paymentRecorded'
  | 'customer.updated'
  | 'shop.profileUpdated'
  | 'shop.currencyUpdated'
  | 'shopAdmin.profileUpdated'
  | 'currency.updated'
  | 'admin.profileUpdated'
  | 'admin.shopCreated'
  | 'admin.shopUpdated'
  | 'admin.shopDeleted'
  | 'admin.shopPaymentRecorded'
  | 'admin.shopAdminsUpdated'
  | 'admin.shopPackageUpdated'
  | 'admin.shopOwnerUpdated'
  | 'shop.staffUpdated'

export interface NavigationMutation {
  kind: NavigationMutationKind
  deviceId?: string
  nasiyaId?: string
  shopId?: string
}

export interface NavigationImpact {
  domains: readonly NavigationDomain[]
  paths: readonly string[]
}

const SHOP_FINANCIAL_PATHS = ['/shop/dashboard', '/shop/hisobot', '/shop/logs'] as const
const SHOP_INVENTORY_PATHS = ['/shop/qurilmalar', '/shop/sotuv/new', '/shop/nasiyalar/new'] as const
const ADMIN_CORE_PATHS = ['/admin', '/admin/shops', '/admin/payments', '/admin/hisobot', '/admin/logs', '/admin/ops'] as const
const ENTITY_ID = /^[A-Za-z0-9_-]+$/

function entityPath(prefix: string, id: string | undefined) {
  return id && ENTITY_ID.test(id) ? `${prefix}/${id}` : null
}

function compactPaths(paths: Array<string | null>) {
  return [...new Set(paths.filter((path): path is string => Boolean(path)))]
}

function shopImpact(domains: readonly NavigationDomain[], paths: Array<string | null>): NavigationImpact {
  return { domains, paths: compactPaths(paths) }
}

/**
 * The one authoritative client-Router-Cache invalidation matrix. It accepts
 * only known mutation kinds and constructs dynamic paths from validated IDs;
 * callers can never submit an arbitrary path to the Server Action.
 */
export function navigationImpactForMutation(mutation: NavigationMutation): NavigationImpact {
  const deviceDetail = entityPath('/shop/qurilmalar', mutation.deviceId)
  const nasiyaDetail = entityPath('/shop/nasiyalar', mutation.nasiyaId)
  const adminShopDetail = entityPath('/admin/shops', mutation.shopId)

  switch (mutation.kind) {
    case 'device.created':
    case 'device.updated':
    case 'device.deleted':
      return shopImpact(
        ['devices', 'reports', 'logs'],
        [...SHOP_INVENTORY_PATHS, deviceDetail, ...SHOP_FINANCIAL_PATHS],
      )
    case 'device.restocked':
      return shopImpact(
        ['devices', 'returns', 'reports', 'logs'],
        [...SHOP_INVENTORY_PATHS, deviceDetail, '/shop/nasiyalar', ...SHOP_FINANCIAL_PATHS],
      )
    case 'sale.created':
    case 'sale.updated':
      return shopImpact(
        ['devices', 'sales', 'customers', 'reports', 'logs', 'overdue'],
        [...SHOP_INVENTORY_PATHS, deviceDetail, '/shop/mijozlar', ...SHOP_FINANCIAL_PATHS],
      )
    case 'sale.paymentRecorded':
      return shopImpact(
        ['devices', 'sales', 'payments', 'customers', 'reports', 'logs', 'overdue'],
        ['/shop/qurilmalar', deviceDetail, '/shop/mijozlar', ...SHOP_FINANCIAL_PATHS],
      )
    case 'nasiya.created':
    case 'nasiya.imported':
    case 'nasiya.updated':
      return shopImpact(
        ['devices', 'nasiyas', 'customers', 'reports', 'logs', 'overdue'],
        [...SHOP_INVENTORY_PATHS, '/shop/nasiyalar', deviceDetail, nasiyaDetail, '/shop/mijozlar', ...SHOP_FINANCIAL_PATHS],
      )
    case 'nasiya.paymentRecorded':
      return shopImpact(
        ['devices', 'nasiyas', 'payments', 'customers', 'reports', 'logs', 'overdue'],
        ['/shop/qurilmalar', '/shop/nasiyalar', deviceDetail, nasiyaDetail, '/shop/mijozlar', ...SHOP_FINANCIAL_PATHS],
      )
    case 'nasiya.reminderUpdated':
      return shopImpact(
        ['nasiyas', 'logs', 'overdue'],
        ['/shop/nasiyalar', nasiyaDetail, '/shop/dashboard', '/shop/logs'],
      )
    case 'return.created':
      return shopImpact(
        ['devices', 'sales', 'nasiyas', 'returns', 'reports', 'logs', 'overdue'],
        [...SHOP_INVENTORY_PATHS, '/shop/nasiyalar', deviceDetail, nasiyaDetail, ...SHOP_FINANCIAL_PATHS],
      )
    case 'olibSotdim.created':
    case 'olibSotdim.paymentRecorded':
      return shopImpact(
        ['olibSotdim', 'devices', 'sales', 'payments', 'reports', 'logs'],
        ['/shop/olib-sotdim', '/shop/qurilmalar', deviceDetail, ...SHOP_FINANCIAL_PATHS],
      )
    case 'customer.updated':
      return shopImpact(
        ['customers', 'nasiyas', 'sales', 'reports', 'logs'],
        ['/shop/mijozlar', '/shop/nasiyalar', ...SHOP_FINANCIAL_PATHS],
      )
    case 'shop.profileUpdated':
    case 'shopAdmin.profileUpdated':
      return shopImpact(
        ['settings', 'logs'],
        ['/shop/settings', '/shop/dashboard', '/shop/logs'],
      )
    case 'shop.currencyUpdated':
    case 'currency.updated':
      return shopImpact(
        ['currency', 'devices', 'sales', 'nasiyas', 'payments', 'customers', 'olibSotdim', 'reports', 'settings'],
        ['/shop', '/shop/dashboard', '/shop/qurilmalar', '/shop/nasiyalar', '/shop/mijozlar', '/shop/olib-sotdim', '/shop/hisobot', '/shop/settings'],
      )
    case 'admin.profileUpdated':
      return shopImpact(['settings', 'adminLogs'], ['/admin', '/admin/settings', '/admin/logs'])
    case 'admin.shopCreated':
    case 'admin.shopUpdated':
    case 'admin.shopDeleted':
    case 'admin.shopPaymentRecorded':
    case 'admin.shopAdminsUpdated':
    case 'admin.shopPackageUpdated':
    case 'admin.shopOwnerUpdated':
      return shopImpact(
        ['adminShops', 'adminPayments', 'adminReports', 'adminLogs', 'adminOps', 'access'],
        [...ADMIN_CORE_PATHS, adminShopDetail],
      )
    case 'shop.staffUpdated':
      return shopImpact(
        ['access', 'settings', 'logs'],
        ['/shop/xodimlar', '/shop/settings', '/shop/logs'],
      )
  }
}

export function isAdminNavigationMutation(kind: NavigationMutationKind) {
  return kind.startsWith('admin.')
}

export function navigationScopeForSession(user: {
  id: string
  role: string
  shopId?: string | null
  sessionVersion?: number | null
  memberKind?: 'SHOP_OWNER' | 'SHOP_STAFF' | null
  authorizationVersion?: number | null
  permissionVersion?: number | null
}) {
  const tenant = user.role === 'SHOP_ADMIN' ? user.shopId : user.id
  const memberKind = user.role === 'SUPER_ADMIN' ? 'SUPER_ADMIN' : (user.memberKind ?? 'SHOP_STAFF')
  return `${user.role}:${tenant ?? 'missing'}:${user.sessionVersion ?? 0}:${memberKind}:${user.authorizationVersion ?? 0}:${user.permissionVersion ?? 0}`
}
