import { NextRequest, after } from 'next/server'
import { z, ZodError } from 'zod'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/generated/prisma/client'
import { requireApiSession, resolveActiveShopId } from '@/lib/api-auth'
import { ok, badRequest, notFound, conflict, serverError } from '@/lib/api-helpers'
import { invalidateShopReturnMutation } from '@/lib/server/cache-tags'
import { processPendingNotifications } from '@/lib/notification-service'
import { logger } from '@/lib/logger'
import { deviceReturnedMessage } from '@/lib/telegram-templates'

type RouteContext = { params: Promise<{ id: string }> }

const returnDeviceSchema = z.object({
  note: z.string({ error: 'Sabab kiritilishi shart' }).min(5, 'Sabab kamida 5 ta belgidan iborat bo\'lishi kerak'),
  refundAmount: z.number().min(0, "Qaytarilgan summa manfiy bo'lmasligi kerak").optional().default(0),
  refundMethod: z.enum(['CASH', 'TRANSFER', 'CARD', 'OTHER']).optional(),
  shopId: z.string().optional(),
}).refine((data) => data.refundAmount <= 0 || data.refundMethod !== undefined, {
  message: "Pul qaytarilgan bo'lsa, qaytarish usuli tanlanishi shart",
  path: ['refundMethod'],
})

export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const guarded = await requireApiSession()
    if (!guarded.ok) return guarded.response
    const { session } = guarded

    const { id: deviceId } = await ctx.params
    const body: unknown = await req.json()
    const parsed = returnDeviceSchema.safeParse(body)
    if (!parsed.success) {
      const firstError = (parsed.error as ZodError).issues[0]?.message ?? "Noto'g'ri ma'lumot"
      return badRequest(firstError)
    }

    const resolved = await resolveActiveShopId(session, parsed.data.shopId)
    if (!resolved.ok) return resolved.response
    const { shopId } = resolved

    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const device = await tx.device.findFirst({
        where: { id: deviceId, shopId, deletedAt: null },
        include: {
          shop: { select: { name: true } },
          sales: { where: { deletedAt: null }, orderBy: { createdAt: 'desc' }, take: 1 },
          nasiya: { where: { deletedAt: null, status: { not: 'CANCELLED' } }, orderBy: { createdAt: 'desc' }, take: 1 },
        },
      })
      if (!device) throw { status: 404, message: 'Qurilma topilmadi' }
      if (!['SOLD_CASH', 'SOLD_NASIYA'].includes(device.status)) {
        throw { status: 409, message: 'Faqat sotilgan qurilmani qaytarish mumkin' }
      }

      const sale = device.sales[0]
      const nasiya = device.nasiya[0]
      const maxRefund = sale
        ? Number(sale.amountPaid)
        : nasiya
          ? Number(
              (
                await tx.nasiyaPayment.aggregate({
                  where: { nasiyaId: nasiya.id, shopId, deletedAt: null },
                  _sum: { amount: true },
                })
              )._sum.amount ?? 0,
            )
          : 0

      if (parsed.data.refundAmount > maxRefund) {
        throw { status: 400, message: 'Qaytariladigan summa mijozdan olingan summadan oshmasligi kerak.' }
      }

      const guardedReturn = await tx.device.updateMany({
        where: { id: deviceId, shopId, deletedAt: null, status: { in: ['SOLD_CASH', 'SOLD_NASIYA'] } },
        data: { status: 'RETURNED', updatedAt: new Date(), note: parsed.data.note },
      })
      if (guardedReturn.count !== 1) {
        throw { status: 409, message: 'Qurilma qaytarish amali allaqachon bajarilgan' }
      }

      if (sale) {
        await tx.sale.update({
          where: { id: sale.id },
          data: {
            deletedAt: new Date(),
            deletedBy: session.user.id,
            deleteNote: `RETURN: ${parsed.data.note}`,
          },
        })
      }

      if (nasiya) {
        await tx.nasiya.update({
          where: { id: nasiya.id },
          data: {
            status: 'CANCELLED',
            deletedAt: new Date(),
            deletedBy: session.user.id,
            deleteNote: `RETURN: ${parsed.data.note}`,
          },
        })
        await tx.nasiyaSchedule.updateMany({
          where: { nasiyaId: nasiya.id, shopId, status: { not: 'PAID' } },
          data: { status: 'DEFERRED', note: `Bekor qilindi: ${parsed.data.note}` },
        })
      }

      const returnRecord = await tx.deviceReturn.create({
        data: {
          shopId,
          deviceId,
          saleId: sale?.id,
          nasiyaId: nasiya?.id,
          refundAmount: parsed.data.refundAmount,
          refundMethod: parsed.data.refundAmount > 0 ? parsed.data.refundMethod : undefined,
          note: parsed.data.note,
          createdBy: session.user.id,
        },
      })

      await tx.log.create({
        data: {
          shopId,
          actorId: session.user.id,
          actorType: session.user.role as 'SUPER_ADMIN' | 'SHOP_ADMIN',
          action: 'RETURN',
          targetType: 'Device',
          targetId: deviceId,
          oldValue: { status: device.status, saleId: sale?.id, nasiyaId: nasiya?.id },
          newValue: {
            status: 'RETURNED',
            returnId: returnRecord.id,
            refundAmount: parsed.data.refundAmount,
            refundMethod: parsed.data.refundMethod,
            note: parsed.data.note,
          },
          note: parsed.data.note,
        },
      })

      // Notify the shop's verified Telegram admins. Rows are committed with the
      // transaction (behind the atomic RETURNED guard above, so a double-click
      // that 409s never reaches here) and flushed after the response.
      const shopAdmins = await tx.shopAdmin.findMany({
        where: { shopId, deletedAt: null, isActive: true, telegramId: { not: '' }, telegramVerifiedAt: { not: null } },
        select: { telegramId: true },
      })
      if (shopAdmins.length > 0) {
        const message = deviceReturnedMessage({
          shopName: device.shop.name,
          device: {
            deviceModel: device.model,
            storage: device.storage,
            color: device.color,
            batteryHealth: device.batteryHealth,
            imei: device.imei,
          },
          refundAmount: parsed.data.refundAmount,
          refundMethod: parsed.data.refundMethod,
          note: parsed.data.note,
          adminName: session.user.name,
        })
        for (const admin of shopAdmins) {
          await tx.notification.create({
            data: {
              shopId,
              type: 'RETURN',
              message,
              telegramId: admin.telegramId!,
              scheduledAt: new Date(),
              relatedId: returnRecord.id,
              relatedType: 'DeviceReturn',
            },
          })
        }
      }

      return tx.device.findFirst({ where: { id: deviceId, shopId } })
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })

    invalidateShopReturnMutation(shopId)

    // Flush freshly-queued notifications after the response (non-blocking).
    // Rows are already committed, so cron is the backstop if this misses.
    after(() => processPendingNotifications().catch((e) => logger.warn('notification flush failed', { event: 'notification.flush_failed', error: e })))

    return ok(result, 'Qurilma qaytarildi va bog\'langan sotuv/nasiya bekor qilindi')
  } catch (err: unknown) {
    if (typeof err === 'object' && err !== null && 'status' in err) {
      const e = err as { status: number; message: string }
      if (e.status === 400) return badRequest(e.message)
      if (e.status === 404) return notFound(e.message)
      if (e.status === 409) return conflict(e.message)
    }
    console.error('[POST /api/devices/[id]/return]', err)
    return serverError()
  }
}
