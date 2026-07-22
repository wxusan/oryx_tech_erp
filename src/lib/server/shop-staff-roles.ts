import { Prisma } from '@/generated/prisma/client'
import {
  SHOP_PERMISSION_CATALOG,
  isActiveShopPermissionCode,
  type ShopPermissionCode,
} from '@/lib/access-control'
import {
  MAX_SHOP_STAFF_ROLES,
  type ShopStaffRoleDto,
} from '@/lib/shop-staff-role-contract'
import { STAFF_LOGS_PERMISSION } from '@/lib/shop-staff-contract'
import { prisma } from '@/lib/prisma'
import type { ShopPrincipal } from '@/lib/server/shop-access'
import {
  SHOP_STAFF_ROLE_KIND,
  SHOP_STAFF_ROLE_PRESETS,
  normalizeShopStaffRoleName,
} from '@/lib/staff-role-presets'

export const shopStaffRoleSelect = {
  id: true,
  name: true,
  normalizedName: true,
  description: true,
  kind: true,
  presetKey: true,
  isArchived: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  permissions: {
    orderBy: { permissionCode: 'asc' as const },
    select: { permissionCode: true },
  },
} satisfies Prisma.ShopStaffRoleSelect

export type ShopStaffRoleRow = Prisma.ShopStaffRoleGetPayload<{
  select: typeof shopStaffRoleSelect
}>

export function projectShopStaffRole(
  row: ShopStaffRoleRow,
  principal: ShopPrincipal,
): ShopStaffRoleDto {
  const isOwner = principal.memberKind === 'SHOP_OWNER'
  const allPermissionCodes = row.permissions
    .map((permission) => permission.permissionCode)
    .filter(isActiveShopPermissionCode)
  const visiblePermissionCodes = isOwner
    ? allPermissionCodes
    : allPermissionCodes.filter((code) => (
        SHOP_PERMISSION_CATALOG.find((permission) => permission.code === code)?.staffManagerDelegable
      ))

  return {
    id: row.id,
    name: row.name,
    normalizedName: row.normalizedName,
    description: row.description,
    kind: row.kind === SHOP_STAFF_ROLE_KIND.BUILT_IN
      ? SHOP_STAFF_ROLE_KIND.BUILT_IN
      : SHOP_STAFF_ROLE_KIND.CUSTOM,
    presetKey: row.presetKey,
    isArchived: row.isArchived,
    version: row.version,
    permissionCodes: visiblePermissionCodes.filter((code) => code !== STAFF_LOGS_PERMISSION),
    logsViewEnabled: isOwner && visiblePermissionCodes.includes(STAFF_LOGS_PERMISSION),
    assignable: isOwner || allPermissionCodes.every((code) => (
      SHOP_PERMISSION_CATALOG.find((permission) => permission.code === code)?.staffManagerDelegable === true
    )),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** Bounded role list shared by the SSR page seed and API refresh. */
export async function getShopStaffRoles(
  shopId: string,
  principal: ShopPrincipal,
  options: { includeArchived?: boolean } = {},
): Promise<ShopStaffRoleDto[]> {
  const rows = await prisma.shopStaffRole.findMany({
    where: {
      shopId,
      ...(options.includeArchived ? {} : { isArchived: false }),
    },
    orderBy: [{ kind: 'asc' }, { createdAt: 'asc' }, { name: 'asc' }],
    take: MAX_SHOP_STAFF_ROLES + 1,
    select: shopStaffRoleSelect,
  })
  return rows.slice(0, MAX_SHOP_STAFF_ROLES).map((role) => projectShopStaffRole(role, principal))
}

/** Seed immutable built-ins inside the same transaction that creates a shop. */
export async function seedBuiltInStaffRoles(
  tx: Prisma.TransactionClient,
  shopId: string,
): Promise<void> {
  for (const preset of SHOP_STAFF_ROLE_PRESETS) {
    const role = await tx.shopStaffRole.upsert({
      where: { shopId_presetKey: { shopId, presetKey: preset.key } },
      update: {},
      create: {
        shopId,
        name: preset.name,
        normalizedName: normalizeShopStaffRoleName(preset.name),
        description: preset.description,
        kind: SHOP_STAFF_ROLE_KIND.BUILT_IN,
        presetKey: preset.key,
      },
      select: { id: true },
    })
    await tx.shopStaffRolePermission.createMany({
      data: preset.permissionCodes.map((permissionCode) => ({
        shopId,
        roleId: role.id,
        permissionCode,
      })),
      skipDuplicates: true,
    })
  }
}

export function roleCanBeDelegatedByStaff(permissionCodes: readonly ShopPermissionCode[]): boolean {
  return permissionCodes.every((code) => (
    SHOP_PERMISSION_CATALOG.find((permission) => permission.code === code)?.staffManagerDelegable === true
  ))
}
