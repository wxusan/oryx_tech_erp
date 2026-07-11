import { NextRequest } from 'next/server'
import { z, ZodError } from 'zod'
import { Prisma } from '@/generated/prisma/client'
import { requireApiSession, resolveActiveShopId } from '@/lib/api-auth'
import { badRequest, notFound, ok, serverError } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { normalizePhone } from '@/lib/phone'
import { phoneSchema } from '@/lib/validations'
import { invalidateShopSaleMutation } from '@/lib/server/cache-tags'
import { logger } from '@/lib/logger'

type RouteContext = { params: Promise<{ id: string }> }

const forbiddenMoneyFields = ['salePrice', 'amountPaid', 'remainingAmount', 'paidFully'] as const

const updateSaleSchema = z.object({
  customerName: z.string().trim().min(2, "Mijoz ismi kamida 2 ta harfdan iborat bo'lishi kerak").max(100).optional(),
  customerPhone: phoneSchema.optional(),
  note: z.string().trim().max(1000, "Izoh 1000 ta belgidan oshmasligi kerak").optional(),
  dueDate: z.coerce.date().nullable().optional(),
  reminderEnabled: z.boolean().optional(),
  paymentMethod: z.enum(['CASH', 'TRANSFER', 'CARD', 'OTHER']).optional(),
  reason: z.string().trim().min(5, "Tahrirlash sababi kamida 5 ta belgidan iborat bo'lishi kerak").max(1000).optional(),
})

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  try {
    const guarded = await requireApiSession()
    if (!guarded.ok) return guarded.response
    const { session } = guarded
    const { id: saleId } = await ctx.params
    const body: unknown = await req.json()

    if (body && typeof body === 'object') {
      const forbidden = forbiddenMoneyFields.find((field) => field in body)
      if (forbidden) {
        return badRequest("Pul summalarini bevosita o'zgartirib bo'lmaydi. Buning uchun adjustment amali kerak.")
      }
    }

    const parsed = updateSaleSchema.safeParse(body)
    if (!parsed.success) {
      const firstError = (parsed.error as ZodError).issues[0]?.message ?? "Noto'g'ri ma'lumot"
      return badRequest(firstError)
    }

    const requestedShopId = body && typeof body === 'object' ? (body as { shopId?: string }).shopId : undefined
    const resolved = await resolveActiveShopId(session, requestedShopId)
    if (!resolved.ok) return resolved.response
    const { shopId } = resolved

    const existing = await prisma.sale.findFirst({
      where: { id: saleId, shopId, deletedAt: null },
      select: {
        id: true,
        shopId: true,
        customerId: true,
        paymentMethod: true,
        dueDate: true,
        reminderEnabled: true,
        note: true,
        customer: { select: { name: true, phone: true, normalizedPhone: true } },
      },
    })
    if (!existing) return notFound('Sotuv topilmadi')

    const saleUpdate = {
      ...(parsed.data.paymentMethod !== undefined ? { paymentMethod: parsed.data.paymentMethod } : {}),
      ...(parsed.data.dueDate !== undefined ? { dueDate: parsed.data.dueDate } : {}),
      ...(parsed.data.reminderEnabled !== undefined ? { reminderEnabled: parsed.data.reminderEnabled } : {}),
      ...(parsed.data.note !== undefined ? { note: parsed.data.note } : {}),
    }
    const customerUpdate = {
      ...(parsed.data.customerName !== undefined ? { name: parsed.data.customerName } : {}),
      ...(parsed.data.customerPhone !== undefined
        ? { phone: parsed.data.customerPhone, normalizedPhone: normalizePhone(parsed.data.customerPhone) }
        : {}),
    }
    if (Object.keys(saleUpdate).length === 0 && Object.keys(customerUpdate).length === 0) {
      return badRequest("O'zgartirish uchun ma'lumot kiritilmadi")
    }

    const reason = parsed.data.reason ?? parsed.data.note ?? 'Sotuv maʼlumotlari tuzatildi'
    const updated = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      if (Object.keys(customerUpdate).length > 0) {
        await tx.customer.update({ where: { id: existing.customerId }, data: customerUpdate })
      }
      const sale = await tx.sale.update({
        where: { id: existing.id },
        data: saleUpdate,
        select: {
          id: true,
          paymentMethod: true,
          dueDate: true,
          reminderEnabled: true,
          note: true,
          customer: { select: { name: true, phone: true } },
        },
      })
      await tx.log.create({
        data: {
          shopId,
          actorId: session.user.id,
          actorType: session.user.role as 'SUPER_ADMIN' | 'SHOP_ADMIN',
          action: 'UPDATE',
          targetType: 'Sale',
          targetId: saleId,
          oldValue: {
            customerName: existing.customer.name,
            customerPhone: existing.customer.phone,
            paymentMethod: existing.paymentMethod,
            dueDate: existing.dueDate,
            reminderEnabled: existing.reminderEnabled,
            note: existing.note,
          },
          newValue: { ...saleUpdate, ...customerUpdate, auditReason: reason },
          note: reason,
        },
      })
      return sale
    })

    invalidateShopSaleMutation(shopId)
    return ok(updated, "Sotuv ma'lumotlari yangilandi")
  } catch (err) {
    logger.error('[PATCH /api/sales/[id]]', { event: 'api.route_error', error: err })
    return serverError()
  }
}
