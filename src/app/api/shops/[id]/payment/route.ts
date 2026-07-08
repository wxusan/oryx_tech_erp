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
import { logger } from '@/lib/logger'

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const guarded = await requireSuperAdmin()
    if (!guarded.ok) return guarded.response
    const { session } = guarded

    const { id } = await ctx.params
    const idempotencyKey = req.headers.get('idempotency-key')?.trim()
    if (!idempotencyKey) {
      return badRequest('Idempotency-Key sarlavhasi kiritilishi shart')
    }

    const body: unknown = await req.json()
    const parsed = addShopPaymentSchema.safeParse(body)

    if (!parsed.success) {
      const firstError = (parsed.error as ZodError).issues[0]?.message ?? "Noto'g'ri ma'lumot"
      return badRequest(firstError)
    }

    const runPaymentTransaction = () =>
      prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const shop = await tx.shop.findFirst({
          where: { id, deletedAt: null, status: { not: 'DELETED' } },
        })
        if (!shop) throw { status: 404, message: "Do'kon topilmadi" }

        const existingPayment = await tx.shopPayment.findUnique({
          where: { shopId_idempotencyKey: { shopId: id, idempotencyKey } },
        })
        if (existingPayment) {
          const duplicateShop = await tx.shop.findUniqueOrThrow({
            where: { id },
            include: {
              admins: { where: { deletedAt: null, isActive: true }, select: shopAdminPublicSelect },
              payments: {
                where: { deletedAt: null },
                orderBy: { paidAt: 'desc' },
                take: 5,
                include: { recordedBy: { select: { name: true, login: true } } },
              },
            },
          })
          return { shop: duplicateShop, duplicate: true }
        }

        const base = max([new Date(), shop.subscriptionDue])
        const newDue = addMonths(base, parsed.data.months)

        await tx.shopPayment.create({
          data: {
            shopId: id,
            amount: parsed.data.amount,
            months: parsed.data.months,
            paymentMethod: parsed.data.paymentMethod,
            note: parsed.data.note,
            idempotencyKey,
            recordedById: session.user.id,
          },
        })

        const updated = await tx.shop.update({
          where: { id },
          data: { subscriptionDue: newDue },
          include: {
            admins: { where: { deletedAt: null, isActive: true }, select: shopAdminPublicSelect },
            payments: {
              where: { deletedAt: null },
              orderBy: { paidAt: 'desc' },
              take: 5,
              include: { recordedBy: { select: { name: true, login: true } } },
            },
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
            oldValue: { subscriptionDue: shop.subscriptionDue },
            newValue: {
              amount: parsed.data.amount,
              months: parsed.data.months,
              paymentMethod: parsed.data.paymentMethod,
              newSubscriptionDue: newDue,
            },
            note: parsed.data.note,
          },
        })

        return { shop: updated, duplicate: false }
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })

    let result: Awaited<ReturnType<typeof runPaymentTransaction>> | undefined
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        result = await runPaymentTransaction()
        break
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034' && attempt < 2) {
          continue
        }
        throw err
      }
    }

    if (!result) return serverError()

    return ok(result.shop, result.duplicate ? "To'lov allaqachon qabul qilingan" : "To'lov muvaffaqiyatli qo'shildi")
  } catch (err: unknown) {
    if (typeof err === 'object' && err !== null && 'status' in err) {
      const e = err as { status: number; message: string }
      if (e.status === 404) return notFound(e.message)
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return serverError("Idempotency-Key bo'yicha to'lov allaqachon yozilgan. Iltimos, sahifani yangilang.")
    }
    logger.error('[POST /api/shops/[id]/payment]', { event: 'api.route_error', error: err })
    return serverError()
  }
}
