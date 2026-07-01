/**
 * POST /api/shops/[id]/payment — record a subscription payment for a shop (super admin only)
 */

import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/generated/prisma/client'
import { addShopPaymentSchema } from '@/lib/validations'
import { ok, badRequest, notFound, serverError } from '@/lib/api-helpers'
import { requireSuperAdmin } from '@/lib/api-auth'
import { shopAdminPublicSelect } from '@/lib/api-selects'
import { addMonths, max } from 'date-fns'
import type { ZodError } from 'zod'

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const guarded = await requireSuperAdmin()
    if (!guarded.ok) return guarded.response
    const { session } = guarded

    const { id } = await ctx.params
    const body: unknown = await req.json()
    const parsed = addShopPaymentSchema.safeParse(body)

    if (!parsed.success) {
      const firstError = (parsed.error as ZodError).issues[0]?.message ?? "Noto'g'ri ma'lumot"
      return badRequest(firstError)
    }

    const shop = await prisma.shop.findFirst({
      where: { id, deletedAt: null, status: { not: 'DELETED' } },
    })
    if (!shop) return notFound("Do'kon topilmadi")

    const base = max([new Date(), shop.subscriptionDue])
    const newDue = addMonths(base, parsed.data.months)

    const updatedShop = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.shopPayment.create({
        data: {
          shopId: id,
          amount: parsed.data.amount,
          months: parsed.data.months,
          paymentMethod: parsed.data.paymentMethod,
          note: parsed.data.note,
          recordedById: session.user.id,
        },
      })

      const updated = await tx.shop.update({
        where: { id },
        data: { subscriptionDue: newDue },
        include: {
          admins: { where: { deletedAt: null, isActive: true }, select: shopAdminPublicSelect },
          payments: { where: { deletedAt: null }, orderBy: { paidAt: 'desc' }, take: 5 },
        },
      })

      await tx.log.create({
        data: {
          shopId: id,
          actorId: session.user.id,
          actorType: 'SUPER_ADMIN',
          action: 'PAYMENT',
          targetType: 'Shop',
          targetId: id,
          newValue: {
            amount: parsed.data.amount,
            months: parsed.data.months,
            paymentMethod: parsed.data.paymentMethod,
            newSubscriptionDue: newDue,
          },
          note: parsed.data.note,
        },
      })

      return updated
    })

    return ok(updatedShop, "To'lov muvaffaqiyatli qo'shildi")
  } catch (err) {
    console.error('[POST /api/shops/[id]/payment]', err)
    return serverError()
  }
}
