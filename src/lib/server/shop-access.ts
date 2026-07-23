import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import {
  calculateRecurringPackagePrice,
  expandShopPermissionCodes,
  isShopFeatureCode,
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
    grantedPermissions: expandShopPermissionCodes(input.permissionCodes),
    packageVersionId: input.packageVersion.id,
  }
}

export function principalHasFeature(principal: ShopPrincipal, feature: ShopFeatureCode) {
  return principal.enabledFeatures.has(feature)
}

export function principalHasPermission(principal: ShopPrincipal, permission: ShopPermissionCode) {
  return principalCan(principal, permission)
}

/** Rebuild authorization after a shop row has been locked for a sensitive
 * mutation, closing the gap between the request guard and transaction commit. */
export async function getLiveShopPrincipalForMutation(
  reader: Prisma.TransactionClient,
  input: { shopId: string; actorId: string; now?: Date },
): Promise<ShopPrincipal | null> {
  const now = input.now ?? new Date()
  const subscriptionCutoff = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000)
  const businessDay = businessDate(tashkentTodayInputValue(now))
  const rows = await reader.$queryRaw<Array<{
    ownerAdminId: string | null
    authorizationVersion: number
    legacyFullAccess: boolean
    permissionVersion: number
    packageVersionId: string
    permissionCodes: string[]
    enabledFeatureCodes: string[]
  }>>(Prisma.sql`
    SELECT
      shop."ownerAdminId" AS "ownerAdminId",
      shop."authorizationVersion" AS "authorizationVersion",
      member."legacyFullAccess" AS "legacyFullAccess",
      member."permissionVersion" AS "permissionVersion",
      package."id" AS "packageVersionId",
      ARRAY(
        SELECT permission."permissionCode"
        FROM "ShopMemberPermission" permission
        WHERE permission."shopId" = shop."id"
          AND permission."shopAdminId" = member."id"
        ORDER BY permission."permissionCode"
      ) AS "permissionCodes",
      ARRAY(
        SELECT package_feature."featureCode"
        FROM "ShopPackageFeature" package_feature
        WHERE package_feature."packageVersionId" = package."id"
          AND package_feature."enabled" = TRUE
        ORDER BY package_feature."featureCode"
      ) AS "enabledFeatureCodes"
    FROM "Shop" shop
    JOIN "ShopAdmin" member
      ON member."id" = ${input.actorId}
      AND member."shopId" = shop."id"
      AND member."isActive" = TRUE
      AND member."deletedAt" IS NULL
    JOIN LATERAL (
      SELECT package_version."id"
      FROM "ShopPackageVersion" package_version
      WHERE package_version."shopId" = shop."id"
        AND package_version."effectiveOn" <= ${businessDay}
      ORDER BY package_version."effectiveOn" DESC, package_version."createdAt" DESC
      LIMIT 1
    ) package ON TRUE
    WHERE shop."id" = ${input.shopId}
      AND shop."status" = 'ACTIVE'
      AND shop."deletedAt" IS NULL
      AND shop."subscriptionDue" >= ${subscriptionCutoff}
    LIMIT 1
  `)
  const row = rows[0]
  if (!row) return null
  return {
    actorId: input.actorId,
    shopId: input.shopId,
    memberKind: shopMemberKind({ memberId: input.actorId, ownerAdminId: row.ownerAdminId }),
    legacyFullAccess: row.legacyFullAccess,
    authorizationVersion: row.authorizationVersion,
    permissionVersion: row.permissionVersion,
    enabledFeatures: new Set(row.enabledFeatureCodes.filter(isShopFeatureCode)) as ReadonlySet<ShopFeatureCode>,
    grantedPermissions: expandShopPermissionCodes(row.permissionCodes),
    packageVersionId: row.packageVersionId,
  }
}

/** One set-based query for cron/domain jobs that need the currently active package entitlement. */
export async function activeShopIdsForFeature(feature: ShopFeatureCode, now = new Date()) {
  const businessDayValue = businessDate(tashkentTodayInputValue(now))
  const rows = await prisma.$queryRaw<Array<{ shopId: string }>>(Prisma.sql`
    SELECT shop."id" AS "shopId"
    FROM "Shop" shop
    JOIN LATERAL (
      SELECT package."id"
      FROM "ShopPackageVersion" package
      WHERE package."shopId" = shop."id"
        AND package."effectiveOn" <= ${businessDayValue}
      ORDER BY package."effectiveOn" DESC, package."createdAt" DESC
      LIMIT 1
    ) active_package ON TRUE
    JOIN "ShopPackageFeature" feature_line
      ON feature_line."packageVersionId" = active_package."id"
     AND feature_line."featureCode" = ${feature}
     AND feature_line."enabled" = TRUE
    WHERE shop."status" = 'ACTIVE' AND shop."deletedAt" IS NULL
  `)
  return new Set(rows.map((row) => row.shopId))
}
