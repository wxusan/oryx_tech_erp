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
import { ok, badRequest, notFound, conflict, serverError } from '@/lib/api-helpers'
import { processPendingNotifications } from '@/lib/notification-service'
import { supplierPayablePaidMessage } from '@/lib/telegram-templates'
import { logger } from '@/lib/logger'
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
      const u = await tx.supplierPayable.update({
        where: { id },
        data: {
          status: 'PAID',
          paidAt,
          paymentMethod: parsed.data.paymentMethod,
          note: parsed.data.note ?? payable.note,
        },
      })

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
        amount: Number(payable.amount),
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
  } catch (err) {
    console.error('[PATCH /api/olib-sotdim/[id]/pay]', err)
    return serverError()
  }
}
