import { Prisma } from '@/generated/prisma/client'
import {
  SHOP_PERMISSION_CATALOG,
  expandShopPermissionCodes,
  isActiveShopPermissionCode,
  permissionRequiredFeatures,
} from '@/lib/access-control'
import {
  legacyStaffPermissionCodes,
  STAFF_LOGS_PERMISSION,
  type ShopStaffDto,
} from '@/lib/shop-staff-contract'
import { principalHasPermission, type ShopPrincipal } from '@/lib/server/shop-access'

export const shopStaffProjectionSelect = {
  id: true,
  name: true,
  phone: true,
  login: true,
  isActive: true,
  telegramId: true,
  telegramVerifiedAt: true,
  telegramNotificationsEnabled: true,
  legacyFullAccess: true,
  permissionVersion: true,
  createdAt: true,
  permissions: { select: { permissionCode: true } },
} satisfies Prisma.ShopAdminSelect

export type ShopStaffProjectionRow = Prisma.ShopAdminGetPayload<{
  select: typeof shopStaffProjectionSelect
}>

const TARGET_READ_PERMISSIONS = [
  'STAFF_VIEW',
  'STAFF_EDIT_PROFILE',
  'STAFF_RESET_PASSWORD',
  'STAFF_STATUS_MANAGE',
  'STAFF_DELETE',
  'STAFF_PERMISSION_MANAGE',
  'STAFF_NOTIFICATION_MANAGE',
] as const

export function principalNeedsStaffTargets(principal: ShopPrincipal): boolean {
  return TARGET_READ_PERMISSIONS.some((permission) => principalHasPermission(principal, permission))
}

export function projectShopStaff(
  row: ShopStaffProjectionRow,
  principal: ShopPrincipal,
): ShopStaffDto {
  const isOwner = principal.memberKind === 'SHOP_OWNER'
  const canView = principalHasPermission(principal, 'STAFF_VIEW')
  const revealProfile = isOwner || canView || principalHasPermission(principal, 'STAFF_EDIT_PROFILE')
  const revealStatus = isOwner || canView || principalHasPermission(principal, 'STAFF_STATUS_MANAGE')
  const revealPermissions = isOwner || principalHasPermission(principal, 'STAFF_PERMISSION_MANAGE')
  const revealNotifications = isOwner || principalHasPermission(principal, 'STAFF_NOTIFICATION_MANAGE')
  const effectivePermissions = row.legacyFullAccess
    ? legacyStaffPermissionCodes(principal.enabledFeatures)
    : [...expandShopPermissionCodes(row.permissions.map((item) => item.permissionCode))]
        .filter(isActiveShopPermissionCode)
        .filter((code) => permissionRequiredFeatures(code).every((feature) => (
          principal.enabledFeatures.has(feature)
        )))
  const visiblePermissions = isOwner
    ? effectivePermissions
    : effectivePermissions.filter((code) => (
        SHOP_PERMISSION_CATALOG.find((item) => item.code === code)?.staffManagerDelegable
      ))

  return {
    id: row.id,
    name: row.name,
    phone: revealProfile ? row.phone : null,
    login: row.login,
    isActive: revealStatus ? row.isActive : null,
    telegramId: revealNotifications ? row.telegramId : null,
    telegramVerifiedAt: revealNotifications ? row.telegramVerifiedAt?.toISOString() ?? null : null,
    telegramNotificationsEnabled: revealNotifications ? row.telegramNotificationsEnabled : null,
    logsViewEnabled: isOwner ? visiblePermissions.includes(STAFF_LOGS_PERMISSION) : null,
    permissionVersion: revealPermissions ? row.permissionVersion : null,
    createdAt: row.createdAt.toISOString(),
    permissionCodes: revealPermissions
      ? visiblePermissions.filter((code) => code !== STAFF_LOGS_PERMISSION)
      : null,
  }
}
