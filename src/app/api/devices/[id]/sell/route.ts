/**
 * POST /api/devices/[id]/sell — mark a device as sold (cash sale)
 *
 * Validates device is IN_STOCK, creates Sale + Customer, updates device status,
 * creates a Notification, and logs the action — all in a single transaction.
 */

import { NextRequest, after } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/generated/prisma/client'
import { requireApiSession, resolveActiveShopId } from '@/lib/api-auth'
import { createSaleSchema } from '@/lib/validations'
import { created, badRequest, notFound, conflict, serverError } from '@/lib/api-helpers'
import { processPendingNotifications } from '@/lib/notification-service'
import { logger } from '@/lib/logger'
import { invalidateShopSaleMutation } from '@/lib/server/cache-tags'
import { normalizePhone } from '@/lib/phone'
import type { ZodError } from 'zod'

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const guarded = await requireApiSession()
    if (!guarded.ok) return guarded.response
    const { session } = guarded

    const { id: deviceId } = await ctx.params
    const body: unknown = await req.json()
    const parsed = createSaleSchema.safeParse(body)

    if (!parsed.success) {
      const firstError = (parsed.error as ZodError).issues[0]?.message ?? "Noto'g'ri ma'lumot"
      return badRequest(firstError)
    }

    const {
      customerName, customerPhone,
      salePrice, paymentMethod,
      paidFully, amountPaid,
      dueDate, reminderEnabled, note,
    } = parsed.data

    // Derive shopId — shop admins are scoped to their shop.
    const resolved = await resolveActiveShopId(session, (body as { shopId?: string }).shopId)
    if (!resolved.ok) return resolved.response
    const { shopId } = resolved
    const normalizedPhone = normalizePhone(customerPhone)

    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const device = await tx.device.findFirst({
        where: { id: deviceId, shopId, deletedAt: null },
      })

      if (!device) throw { status: 404, message: "Qurilma topilmadi" }
      if (device.status !== 'IN_STOCK') throw { status: 409, message: "Qurilma sotishga tayyor emas" }

      const reserved = await tx.device.updateMany({
        where: { id: deviceId, shopId, deletedAt: null, status: 'IN_STOCK' },
        data: { status: 'SOLD_CASH', updatedAt: new Date() },
      })
      if (reserved.count !== 1) throw { status: 409, message: "Qurilma allaqachon sotilgan" }

      const existingCustomer = await tx.customer.findFirst({
        where: {
          shopId,
          deletedAt: null,
          OR: [
            ...(normalizedPhone ? [{ normalizedPhone }] : []),
            { phone: customerPhone },
          ],
        },
      })
      const customer = existingCustomer
        ? await tx.customer.update({
            where: { id: existingCustomer.id },
            data: { name: customerName, normalizedPhone },
          })
        : await tx.customer.create({
            data: { shopId, name: customerName, phone: customerPhone, normalizedPhone },
          })

      const paid = paidFully ? salePrice : amountPaid ?? 0
      const remaining = salePrice - paid

      const sale = await tx.sale.create({
        data: {
          shopId,
          deviceId,
          customerId: customer.id,
          salePrice,
          paymentMethod: parsed.data.paymentMethod,
          paidFully: remaining <= 0,
          amountPaid: paid,
          remainingAmount: remaining,
          dueDate,
          reminderEnabled: reminderEnabled ?? false,
          note,
          createdBy: session.user.id,
        },
      })

      if (paid > 0) {
        await tx.salePayment.create({
          data: {
            saleId: sale.id,
            shopId,
            amount: paid,
            paymentMethod,
            paidAt: new Date(),
            note: remaining > 0 ? "Boshlang'ich to'lov" : "To'liq to'lov",
            idempotencyKey: `sale-initial:${sale.id}`,
            createdBy: session.user.id,
          },
        })
      }

      const shopAdmins = await tx.shopAdmin.findMany({
        where: { shopId, deletedAt: null, isActive: true, telegramId: { not: '' }, telegramVerifiedAt: { not: null } },
      })
      for (const admin of shopAdmins) {
        await tx.notification.create({
          data: {
            shopId,
            type: 'SALE',
            message: `✅ Yangi sotuv\n📱 ${device.model}\n👤 ${customerName}\n📞 ${customerPhone}\n💰 ${salePrice.toLocaleString()} so'm`,
            telegramId: admin.telegramId!,
            scheduledAt: new Date(),
            relatedId: sale.id,
            relatedType: 'Sale',
          },
        })
      }

      await tx.log.create({
        data: {
          shopId,
          actorId: session.user.id,
          actorType: session.user.role as 'SUPER_ADMIN' | 'SHOP_ADMIN',
          action: 'SELL',
          targetType: 'Device',
          targetId: deviceId,
          newValue: {
            salePrice,
            customerName,
            paymentMethod,
            amountPaid: paid,
            remainingAmount: remaining,
            dueDate,
            paidFully: remaining <= 0,
          },
        },
      })

      return sale
    })

    invalidateShopSaleMutation(shopId)

    // Flush freshly-queued notifications after the response (non-blocking).
    // The rows are already committed, so cron is the backstop if this misses.
    after(() => processPendingNotifications().catch((e) => logger.warn('notification flush failed', { event: 'notification.flush_failed', error: e })))

    return created(result, "Qurilma muvaffaqiyatli sotildi")
  } catch (err: unknown) {
    if (typeof err === 'object' && err !== null && 'status' in err) {
      const e = err as { status: number; message: string }
      if (e.status === 404) return notFound(e.message)
      if (e.status === 409) return conflict(e.message)
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return conflict('Bu telefon raqam bilan faol mijoz allaqachon mavjud')
    }
    console.error('[POST /api/devices/[id]/sell]', err)
    return serverError()
  }
}
