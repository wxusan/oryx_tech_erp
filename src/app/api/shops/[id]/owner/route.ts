import { NextRequest } from 'next/server'
import { Prisma } from '@/generated/prisma/client'
import { z } from 'zod'
import { requireSuperAdmin } from '@/lib/api-auth'
import { badRequest, conflict, notFound, ok, payloadTooLarge, serverError } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { enabledFeatureSet, getActiveShopPackage } from '@/lib/server/shop-access'
import {
  isInvalidRequestBody,
  isRequestBodyTooLarge,
  readLimitedJsonBody,
} from '@/lib/server/request-limits'
import { logger } from '@/lib/logger'
import { isRetryableTransactionError } from '@/lib/server/transaction-retry'

type RouteContext = { params: Promise<{ id: string }> }

const ownerResolutionSchema = z.object({
  ownerAdminId: z.string().min(1).max(100),
  reason: z.string().trim().min(5, "Egalikni biriktirish sababi kamida 5 ta belgidan iborat bo'lishi kerak").max(1000),
})

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

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const guarded = await requireSuperAdmin()
    if (!guarded.ok) return guarded.response
    const { session } = guarded
    const { id } = await context.params
    const parsed = ownerResolutionSchema.safeParse(await readLimitedJsonBody(request))
    if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? "Egalik ma'lumoti noto'g'ri")

    const result = await runSerializable(() => prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Shop" WHERE "id" = ${id} FOR UPDATE`)
      const shop = await tx.shop.findFirst({
        where: { id, deletedAt: null },
        select: { ownerAdminId: true, ownershipStatus: true },
      })
      if (!shop) throw Object.assign(new Error('SHOP_NOT_FOUND'), { code: 'SHOP_NOT_FOUND' })

      const nextOwner = await tx.shopAdmin.findFirst({
        where: {
          id: parsed.data.ownerAdminId,
          shopId: id,
          isActive: true,
          deletedAt: null,
        },
        select: { id: true, name: true, login: true },
      })
      if (!nextOwner) throw Object.assign(new Error('OWNER_NOT_FOUND'), { code: 'OWNER_NOT_FOUND' })

      if (shop.ownerAdminId === nextOwner.id && shop.ownershipStatus === 'RESOLVED') {
        return { unchanged: true, owner: nextOwner }
      }

      const activePackage = await getActiveShopPackage(id, new Date(), tx)
      if (!activePackage) throw Object.assign(new Error('PACKAGE_NOT_FOUND'), { code: 'PACKAGE_NOT_FOUND' })
      const staffEnabled = enabledFeatureSet(activePackage).has('STAFF_ACCESS')
      const affectedIds = [shop.ownerAdminId, nextOwner.id].filter((value): value is string => Boolean(value))

      await tx.shop.update({
        where: { id },
        data: {
          ownerAdminId: nextOwner.id,
          ownershipStatus: 'RESOLVED',
          ownershipResolvedAt: new Date(),
          ownershipResolvedById: session.user.id,
          authorizationVersion: { increment: 1 },
        },
      })

      await tx.shopAdmin.update({
        where: { id: nextOwner.id },
        data: {
          isActive: true,
          legacyFullAccess: false,
          sessionVersion: { increment: 1 },
        },
      })

      if (shop.ownerAdminId && shop.ownerAdminId !== nextOwner.id) {
        await tx.shopAdmin.update({
          where: { id: shop.ownerAdminId },
          data: {
            isActive: staffEnabled,
            sessionVersion: { increment: 1 },
          },
        })
      }

      if (affectedIds.length) {
        await tx.authSession.updateMany({
          where: { actorType: 'SHOP_ADMIN', actorId: { in: affectedIds }, revokedAt: null },
          data: { revokedAt: new Date() },
        })
      }

      await tx.log.create({
        data: {
          shopId: id,
          actorId: session.user.id,
          actorType: 'SUPER_ADMIN',
          action: 'OWNER_RESOLVE',
          targetType: 'ShopAdmin',
          targetId: nextOwner.id,
          oldValue: { ownerAdminId: shop.ownerAdminId, ownershipStatus: shop.ownershipStatus },
          newValue: { ownerAdminId: nextOwner.id, ownerName: nextOwner.name, staffAccessEnabled: staffEnabled },
          note: parsed.data.reason,
        },
      })

      return { unchanged: false, owner: nextOwner }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }))

    return ok(result, result.unchanged ? "Do'kon egasi o'zgarmadi" : "Do'kon egasi biriktirildi")
  } catch (error) {
    if (isRequestBodyTooLarge(error)) return payloadTooLarge()
    if (isInvalidRequestBody(error)) return badRequest("So'rov ma'lumoti noto'g'ri")
    if (error && typeof error === 'object' && 'code' in error) {
      if (error.code === 'SHOP_NOT_FOUND') return notFound("Do'kon topilmadi")
      if (error.code === 'OWNER_NOT_FOUND') return notFound("Tanlangan faol profil bu do'konga tegishli emas")
      if (error.code === 'PACKAGE_NOT_FOUND') return conflict("Do'konning faol paketi topilmadi")
    }
    logger.error('[PATCH /api/shops/[id]/owner]', { event: 'api.route_error', error })
    return serverError()
  }
}
