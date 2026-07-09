/**
 * PATCH /api/olib-sotdim/[id]/pay — mark a supplier payable as paid
 *
 * [id] is the SupplierPayable ID. Sets status PAID, stamps paidAt/paymentMethod,
 * logs the completion, and sends a confirmation Telegram message. Once PAID,
 * the cron reminder queries (status PENDING/OVERDUE) never select this row
 * again, so reminders stop naturally — no separate "cancel reminder" step.
 */

import { NextRequest, after } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/generated/prisma/client'
import { requireApiSession, resolveActiveShopId } from '@/lib/api-auth'
import { markSupplierPayablePaidSchema } from '@/lib/validations'
import { ok, badRequest, notFound, conflict, serverError, tooManyRequests } from '@/lib/api-helpers'
import { processPendingNotifications } from '@/lib/notification-service'
import { supplierPayablePaidMessage } from '@/lib/telegram-templates'
import { logger } from '@/lib/logger'
import { rateLimitKey } from '@/lib/rate-limit'
import { checkRateLimitDistributed } from '@/lib/rate-limit-adapter'
import { invalidateShopSaleMutation } from '@/lib/server/cache-tags'
import { getShopCurrencyContext } from '@/lib/server/currency'
import type { ZodError } from 'zod'

type RouteContext = { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  try {
    const guarded = await requireApiSession()
    if (!guarded.ok) return guarded.response
    const { session } = guarded

    const { id } = await ctx.params
    const body: unknown = await req.json()
    const parsed = markSupplierPayablePaidSchema.safeParse(body)
    if (!parsed.success) {
      const firstError = (parsed.error as ZodError).issues[0]?.message ?? "Noto'g'ri ma'lumot"
      return badRequest(firstError)
    }

    const resolved = await resolveActiveShopId(session, (body as { shopId?: string }).shopId)
    if (!resolved.ok) return resolved.response
    const { shopId } = resolved

    // Per-instance abuse guard (not distributed — see src/lib/rate-limit.ts).
    const rate = await checkRateLimitDistributed(rateLimitKey('supplier-payable-pay', shopId, session.user.id), { windowMs: 60_000, max: 20 })
    if (!rate.allowed) return tooManyRequests(rate.retryAfterSeconds)

    const currency = await getShopCurrencyContext(shopId)

    const payable = await prisma.supplierPayable.findFirst({
      where: { id, shopId, deletedAt: null },
      include: {
        device: { select: { model: true, storage: true, color: true, batteryHealth: true, imei: true } },
      },
    })
    if (!payable) return notFound('Yozuv topilmadi')
    if (payable.status === 'PAID') return conflict("Bu to'lov allaqachon qayd etilgan")

    const paidAt = parsed.data.paidAt ?? new Date()

    const updated = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Atomic guard: only flip if it is still PENDING (prevents a double
      // mark-as-paid race — e.g. a double-click — from sending two
      // confirmation notifications and two log entries for the same payable).
      const flipped = await tx.supplierPayable.updateMany({
        where: { id, shopId, deletedAt: null, status: { not: 'PAID' } },
        data: {
          status: 'PAID',
          paidAt,
          paymentMethod: parsed.data.paymentMethod,
          note: parsed.data.note ?? payable.note,
        },
      })
      if (flipped.count !== 1) {
        throw { status: 409, message: "Bu to'lov allaqachon qayd etilgan" }
      }
      const u = await tx.supplierPayable.findFirstOrThrow({ where: { id, shopId } })

      const shop = await tx.shop.findUnique({ where: { id: shopId }, select: { name: true } })
      const shopAdmins = await tx.shopAdmin.findMany({
        where: { shopId, deletedAt: null, isActive: true, telegramId: { not: '' }, telegramVerifiedAt: { not: null } },
      })
      const message = supplierPayablePaidMessage({
        shopName: shop?.name ?? '',
        device: {
          deviceModel: payable.device.model,
          storage: payable.device.storage,
          color: payable.device.color,
          batteryHealth: payable.device.batteryHealth,
          imei: payable.device.imei,
        },
        supplierName: payable.supplierName,
        supplierPhone: payable.supplierPhone,
        amount: Number(payable.contractAmount),
        contractCurrency: payable.contractCurrency,
        paymentMethod: parsed.data.paymentMethod,
        adminName: session.user.name,
        currency,
      })
      for (const admin of shopAdmins) {
        await tx.notification.create({
          data: {
            shopId,
            type: 'SUPPLIER_PAYABLE_PAID',
            message,
            telegramId: admin.telegramId!,
            scheduledAt: new Date(),
            relatedId: id,
            relatedType: 'SupplierPayable',
          },
        })
      }

      await tx.log.create({
        data: {
          shopId,
          actorId: session.user.id,
          actorType: session.user.role as 'SUPER_ADMIN' | 'SHOP_ADMIN',
          action: 'SUPPLIER_PAYABLE_PAID',
          targetType: 'SupplierPayable',
          targetId: id,
          newValue: {
            amount: Number(payable.amount),
            paymentMethod: parsed.data.paymentMethod,
            supplierName: payable.supplierName,
          },
          note: parsed.data.note,
        },
      })

      return u
    })

    invalidateShopSaleMutation(shopId)

    after(() =>
      processPendingNotifications().catch((e) =>
        logger.warn('notification flush failed', { event: 'notification.flush_failed', route: '/api/olib-sotdim/[id]/pay', error: e }),
      ),
    )

    return ok(
      { ...updated, amount: Number(updated.amount) },
      "Yetkazib beruvchiga to'lov qayd etildi",
    )
  } catch (err: unknown) {
    if (typeof err === 'object' && err !== null && 'status' in err) {
      const e = err as { status: number; message: string }
      if (e.status === 409) return conflict(e.message)
    }
    logger.error('[PATCH /api/olib-sotdim/[id]/pay]', { event: 'api.route_error', error: err })
    return serverError()
  }
}
