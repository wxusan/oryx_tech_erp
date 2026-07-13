import type { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import {
  calculateRecurringPackagePrice,
  isShopFeatureCode,
  isShopPermissionCode,
  principalCan,
  shopMemberKind,
  type ShopFeatureCode,
  type ShopMemberKind,
  type ShopPermissionCode,
} from '@/lib/access-control'
import { tashkentTodayInputValue } from '@/lib/timezone'

type PackageReader = Pick<Prisma.TransactionClient, 'shopPackageVersion'>

function businessDate(dayKey: string) {
  return new Date(`${dayKey}T00:00:00.000Z`)
}

export const activePackageSelect = {
  id: true,
  shopId: true,
  effectiveOn: true,
  basePrice: true,
  currency: true,
  discountAmount: true,
  pricingNeedsReview: true,
  note: true,
  createdAt: true,
  features: {
    orderBy: { feature: { sortOrder: 'asc' as const } },
    select: {
      featureCode: true,
      enabled: true,
      recurringPrice: true,
      feature: {
        select: {
          nameUz: true,
          descriptionUz: true,
          billable: true,
          platformCore: true,
          sortOrder: true,
        },
      },
    },
  },
} satisfies Prisma.ShopPackageVersionSelect

export async function getActiveShopPackage(
  shopId: string,
  now = new Date(),
  reader: PackageReader = prisma,
) {
  return reader.shopPackageVersion.findFirst({
    where: {
      shopId,
      effectiveOn: { lte: businessDate(tashkentTodayInputValue(now)) },
    },
    orderBy: [{ effectiveOn: 'desc' }, { createdAt: 'desc' }],
    select: activePackageSelect,
  })
}

export type ActiveShopPackage = NonNullable<Awaited<ReturnType<typeof getActiveShopPackage>>>

export function enabledFeatureSet(packageVersion: ActiveShopPackage | null): ReadonlySet<ShopFeatureCode> {
  const codes = packageVersion?.features
    .filter((item) => item.enabled && isShopFeatureCode(item.featureCode))
    .map((item) => item.featureCode as ShopFeatureCode) ?? []
  return new Set(codes)
}

export function packageRecurringPrice(packageVersion: ActiveShopPackage) {
  return calculateRecurringPackagePrice({
    basePrice: packageVersion.basePrice.toString(),
    discountAmount: packageVersion.discountAmount.toString(),
    currency: packageVersion.currency,
    features: packageVersion.features.map((item) => {
      if (!isShopFeatureCode(item.featureCode)) {
        throw new Error(`Noma'lum paket moduli: ${item.featureCode}`)
      }
      return {
        featureCode: item.featureCode,
        enabled: item.enabled,
        recurringPrice: item.recurringPrice.toString(),
      }
    }),
  })
}

export interface ShopPrincipal {
  actorId: string
  shopId: string
  memberKind: ShopMemberKind
  legacyFullAccess: boolean
  authorizationVersion: number
  permissionVersion: number
  enabledFeatures: ReadonlySet<ShopFeatureCode>
  grantedPermissions: ReadonlySet<ShopPermissionCode>
  packageVersionId: string
}

export function buildShopPrincipal(input: {
  actorId: string
  shopId: string
  ownerAdminId: string | null
  legacyFullAccess: boolean
  authorizationVersion: number
  permissionVersion: number
  permissionCodes: readonly string[]
  packageVersion: ActiveShopPackage
}): ShopPrincipal {
  return {
    actorId: input.actorId,
    shopId: input.shopId,
    memberKind: shopMemberKind({ memberId: input.actorId, ownerAdminId: input.ownerAdminId }),
    legacyFullAccess: input.legacyFullAccess,
    authorizationVersion: input.authorizationVersion,
    permissionVersion: input.permissionVersion,
    enabledFeatures: enabledFeatureSet(input.packageVersion),
    grantedPermissions: new Set(input.permissionCodes.filter(isShopPermissionCode)),
    packageVersionId: input.packageVersion.id,
  }
}

export function principalHasFeature(principal: ShopPrincipal, feature: ShopFeatureCode) {
  return principal.enabledFeatures.has(feature)
}

export function principalHasPermission(principal: ShopPrincipal, permission: ShopPermissionCode) {
  return principalCan(principal, permission)
}
