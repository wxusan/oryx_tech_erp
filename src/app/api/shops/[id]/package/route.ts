import { NextRequest } from 'next/server'
import { Prisma } from '@/generated/prisma/client'
import { requireSuperAdmin } from '@/lib/api-auth'
import { badRequest, conflict, created, notFound, ok, payloadTooLarge, serverError } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { shopPackageDraftSchema, type ShopPackageDraft, type ShopPackageDto } from '@/lib/shop-package-contract'
import { getActiveShopPackage, packageRecurringPrice } from '@/lib/server/shop-access'
import { currentBusinessLogContext } from '@/lib/server/request-context'
import {
  isInvalidRequestBody,
  isRequestBodyTooLarge,
  readLimitedJsonBody,
} from '@/lib/server/request-limits'
import { tashkentTodayInputValue } from '@/lib/timezone'
import { logger } from '@/lib/logger'
import { isRetryableTransactionError } from '@/lib/server/transaction-retry'
import {
  createTelegramDisableTransitionInTransaction,
  purgeTelegramIdentityInTransaction,
  TELEGRAM_PURGE_REASON,
} from '@/lib/server/telegram-lifecycle'

type RouteContext = { params: Promise<{ id: string }> }

const packageVersionSelect = {
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

type PackageVersionRow = Prisma.ShopPackageVersionGetPayload<{ select: typeof packageVersionSelect }>

function packageDto(row: PackageVersionRow): ShopPackageDto {
  return {
    id: row.id,
    effectiveOn: row.effectiveOn.toISOString().slice(0, 10),
    basePrice: row.basePrice.toString(),
    currency: row.currency,
    discountAmount: row.discountAmount.toString(),
    pricingNeedsReview: row.pricingNeedsReview,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    price: packageRecurringPrice(row),
    features: row.features.map((item) => ({
      featureCode: item.featureCode as ShopPackageDto['features'][number]['featureCode'],
      nameUz: item.feature.nameUz,
      descriptionUz: item.feature.descriptionUz,
      billable: item.feature.billable,
      enabled: item.enabled,
      recurringPrice: item.recurringPrice.toString(),
    })),
  }
}

function staffEnabled(row: { features: Array<{ featureCode: string; enabled: boolean }> } | null) {
  return row?.features.some((item) => item.featureCode === 'STAFF_ACCESS' && item.enabled) ?? false
}

function businessDay(date: Date) {
  return tashkentTodayInputValue(date)
}

async function runSerializable<T>(operation: () => Promise<T>) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      if (!isRetryableTransactionError(error) || attempt === 2) throw error
    }
  }
  throw new Error('SERIALIZABLE_TRANSACTION_FAILED')
}

function priceAffectingChange(current: PackageVersionRow, next: ShopPackageDraft) {
  const currentBillable = current.features
    .filter((item) => item.feature.billable)
    .map((item) => `${item.featureCode}:${item.enabled}:${item.recurringPrice.toString()}`)
    .sort()
    .join('|')
  const nextBillable = next.features
    .filter((item) => item.featureCode !== 'STAFF_ACCESS')
    .map((item) => `${item.featureCode}:${item.enabled}:${item.recurringPrice}`)
    .sort()
    .join('|')
  return Number(current.basePrice) !== next.basePrice
    || current.currency !== next.currency
    || Number(current.discountAmount) !== next.discountAmount
    || currentBillable !== nextBillable
}

export async function GET(req: NextRequest, context: RouteContext) {
  try {
    const guarded = await requireSuperAdmin()
    if (!guarded.ok) return guarded.response
    const { id } = await context.params
    const requestedTake = Number(req.nextUrl.searchParams.get('take') ?? 20)
    const take = Number.isFinite(requestedTake) ? Math.min(Math.max(Math.trunc(requestedTake), 1), 100) : 20

    const shop = await prisma.shop.findFirst({ where: { id, deletedAt: null }, select: { id: true } })
    if (!shop) return notFound('Do‘kon topilmadi.')

    const [active, versions] = await Promise.all([
      getActiveShopPackage(id),
      prisma.shopPackageVersion.findMany({
        where: { shopId: id },
        orderBy: [{ effectiveOn: 'desc' }, { createdAt: 'desc' }],
        take,
        select: packageVersionSelect,
      }),
    ])

    return ok({
      active: active ? packageDto(active) : null,
      versions: versions.map(packageDto),
    })
  } catch (error) {
    logger.error('[GET /api/shops/[id]/package]', { event: 'api.route_error', error })
    return serverError()
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const guarded = await requireSuperAdmin()
    if (!guarded.ok) return guarded.response
    const { session } = guarded
    const { id } = await context.params
    const parsed = shopPackageDraftSchema.safeParse(await readLimitedJsonBody(request))
    if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? "Paket ma'lumoti noto'g'ri")

    const today = tashkentTodayInputValue()
    if (parsed.data.effectiveOn < today) {
      return badRequest("Paket o'zgarishini o'tgan sana bilan kiritib bo'lmaydi")
    }

    const shop = await prisma.shop.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        ownerAdminId: true,
        ownershipStatus: true,
        subscriptionDue: true,
      },
    })
    if (!shop) return notFound("Do'kon topilmadi")

    const current = await getActiveShopPackage(id)
    const currentStaffEnabled = staffEnabled(current)
    const nextStaffEnabled = parsed.data.features.find((item) => item.featureCode === 'STAFF_ACCESS')!.enabled
    const staffChanged = current !== null && currentStaffEnabled !== nextStaffEnabled
    if (staffChanged && parsed.data.effectiveOn !== today) {
      return badRequest('Xodim uchun kiritilgan sana noto‘g‘ri.')
    }
    if (staffChanged && !nextStaffEnabled && (shop.ownershipStatus !== 'RESOLVED' || !shop.ownerAdminId)) {
      return conflict('Do‘kon egasi hali biriktirilmagan.')
    }

    if (current) {
      const changesPrice = priceAffectingChange(current, parsed.data)
      const nextServiceBoundary = shop.subscriptionDue > new Date() ? businessDay(shop.subscriptionDue) : today
      if (changesPrice && parsed.data.effectiveOn < nextServiceBoundary) {
        return badRequest('Kiritilgan narx ruxsat etilgan chegaradan tashqarida.')
      }
    }

    const effectiveOn = new Date(`${parsed.data.effectiveOn}T00:00:00.000Z`)
    const version = await runSerializable(() => prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Shop" WHERE "id" = ${id} FOR UPDATE`)
      const existingShop = await tx.shop.findFirst({
        where: { id, deletedAt: null },
        select: { authorizationVersion: true, ownerAdminId: true, ownershipStatus: true, subscriptionDue: true },
      })
      if (!existingShop) throw Object.assign(new Error('SHOP_NOT_FOUND'), { code: 'SHOP_NOT_FOUND' })

      const lockedCurrent = await tx.shopPackageVersion.findFirst({
        where: { shopId: id, effectiveOn: { lte: new Date(`${today}T00:00:00.000Z`) } },
        orderBy: [{ effectiveOn: 'desc' }, { createdAt: 'desc' }],
        select: packageVersionSelect,
      })
      const lockedStaffEnabled = staffEnabled(lockedCurrent)
      const lockedEnabledFeatures = new Set<string>(
        lockedCurrent?.features.filter((feature) => feature.enabled).map((feature) => feature.featureCode) ?? [],
      )
      const nextEnabledFeatures = new Set<string>(
        parsed.data.features.filter((feature) => feature.enabled).map((feature) => feature.featureCode),
      )
      const entitlementsChanged = lockedEnabledFeatures.size !== nextEnabledFeatures.size ||
        [...lockedEnabledFeatures].some((feature) => !nextEnabledFeatures.has(feature))
      const lockedStaffChanged = lockedCurrent !== null && lockedStaffEnabled !== nextStaffEnabled
      if (lockedStaffChanged && parsed.data.effectiveOn !== today) {
        throw Object.assign(new Error('STAFF_DATE_INVALID'), { code: 'STAFF_DATE_INVALID' })
      }
      if (lockedStaffChanged && !nextStaffEnabled && (existingShop.ownershipStatus !== 'RESOLVED' || !existingShop.ownerAdminId)) {
        throw Object.assign(new Error('OWNER_UNRESOLVED'), { code: 'OWNER_UNRESOLVED' })
      }
      if (lockedCurrent && priceAffectingChange(lockedCurrent, parsed.data)) {
        const boundary = existingShop.subscriptionDue > new Date() ? businessDay(existingShop.subscriptionDue) : today
        if (parsed.data.effectiveOn < boundary) {
          throw Object.assign(new Error('PRICE_BOUNDARY'), { code: 'PRICE_BOUNDARY', boundary })
        }
      }

      const createdVersion = await tx.shopPackageVersion.create({
        data: {
          shopId: id,
          effectiveOn,
          basePrice: parsed.data.basePrice,
          currency: parsed.data.currency,
          discountAmount: parsed.data.discountAmount,
          pricingNeedsReview: false,
          note: parsed.data.note,
          createdById: session.user.id,
          features: {
            create: parsed.data.features.map((feature) => ({
              featureCode: feature.featureCode,
              enabled: feature.enabled,
              recurringPrice: feature.recurringPrice,
            })),
          },
        },
        select: packageVersionSelect,
      })

      if (!nextEnabledFeatures.has('TELEGRAM')) {
        await createTelegramDisableTransitionInTransaction(tx, {
          packageVersionId: createdVersion.id,
          shopId: id,
          effectiveOn: createdVersion.effectiveOn,
        })
      }

      if (parsed.data.effectiveOn === today) {
        await tx.shop.update({ where: { id }, data: { authorizationVersion: { increment: 1 } } })
        if (entitlementsChanged) {
          await tx.authSession.updateMany({
            where: { actorType: 'SHOP_ADMIN', shopId: id, revokedAt: null },
            data: { revokedAt: new Date() },
          })
        }
      }

      if (lockedStaffChanged && !nextStaffEnabled) {
        const staff = await tx.shopAdmin.findMany({
          where: {
            shopId: id,
            id: { not: existingShop.ownerAdminId! },
            deletedAt: null,
          },
          select: { id: true },
        })
        const staffIds = staff.map((item) => item.id)
        if (staffIds.length) {
          await tx.shopAdmin.updateMany({
            where: { id: { in: staffIds }, shopId: id },
            data: { isActive: false, sessionVersion: { increment: 1 } },
          })
          await tx.authSession.updateMany({
            where: { actorType: 'SHOP_ADMIN', actorId: { in: staffIds }, revokedAt: null },
            data: { revokedAt: new Date() },
          })
          await purgeTelegramIdentityInTransaction(
            tx,
            { type: 'SHOP_STAFF', shopId: id, ownerAdminId: existingShop.ownerAdminId! },
            { reason: TELEGRAM_PURGE_REASON.ACCOUNT_INACTIVE },
          )
        }
      }

      const audit = currentBusinessLogContext()
      await tx.log.create({
        data: {
          shopId: id,
          actorId: session.user.id,
          actorType: 'SUPER_ADMIN',
          action: 'PACKAGE_VERSION_CREATE',
          targetType: 'ShopPackageVersion',
          targetId: createdVersion.id,
          newValue: {
            effectiveOn: parsed.data.effectiveOn,
            basePrice: parsed.data.basePrice,
            currency: parsed.data.currency,
            discountAmount: parsed.data.discountAmount,
            recurringPrice: packageRecurringPrice(createdVersion).recurringPrice,
            enabledFeatures: parsed.data.features.filter((item) => item.enabled).map((item) => item.featureCode),
          },
          note: parsed.data.note,
          requestId: audit.requestId,
          ipAddress: audit.ipAddress,
        },
      })

      return createdVersion
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }))

    return created(packageDto(version), 'Paket versiyasi saqlandi')
  } catch (error) {
    if (isRequestBodyTooLarge(error)) return payloadTooLarge()
    if (isInvalidRequestBody(error)) return badRequest("So'rov ma'lumoti noto'g'ri")
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return conflict('Bu kuchga kirish sanasi uchun paket versiyasi allaqachon mavjud')
    }
    if (error && typeof error === 'object' && 'code' in error && error.code === 'SHOP_NOT_FOUND') {
      return notFound('Do‘kon topilmadi.')
    }
    if (error && typeof error === 'object' && 'code' in error) {
      if (error.code === 'STAFF_DATE_INVALID') return badRequest('Xodim uchun kiritilgan sana noto‘g‘ri.')
      if (error.code === 'OWNER_UNRESOLVED') return conflict('Do‘kon egasi hali biriktirilmagan.')
      if (error.code === 'PRICE_BOUNDARY') {
        return badRequest('Kiritilgan narx ruxsat etilgan chegaradan tashqarida.')
      }
    }
    if (error instanceof Error && error.message === 'SERIALIZABLE_TRANSACTION_FAILED') return serverError('Amalni yakunlab bo‘lmadi. Iltimos, qayta urinib ko‘ring.')
    logger.error('[POST /api/shops/[id]/package]', { event: 'api.route_error', error })
    return serverError()
  }
}
