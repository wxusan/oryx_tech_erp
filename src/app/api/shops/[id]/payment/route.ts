/**
 * POST /api/shops/[id]/payment — record a subscription payment for a shop (super admin only)
 */

import { NextRequest } from 'next/server'
import { createHash } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/generated/prisma/client'
import { addShopPaymentSchema } from '@/lib/validations'
import { ok, badRequest, notFound, conflict, serverError } from '@/lib/api-helpers'
import { requireSuperAdmin } from '@/lib/api-auth'
import { shopAdminPublicSelect } from '@/lib/api-selects'
import { addMonths, max } from 'date-fns'
import type { ZodError } from 'zod'
import { logger } from '@/lib/logger'
import { isRetryableTransactionError } from '@/lib/server/transaction-retry'
import { sameMoney, sameOptionalText } from '@/lib/idempotency-replay'
import { getActiveShopPackage, packageRecurringPrice } from '@/lib/server/shop-access'
import { tashkentTodayInputValue } from '@/lib/timezone'
import { getUsdUzsRate } from '@/lib/server/currency'
import { buildShopPaymentSnapshots } from '@/lib/admin-money'

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

    // Fetch once, before the serializable transaction. A missing rate does
    // not block a native-currency receipt; the opposite-currency reporting
    // snapshot is left explicitly PARTIAL instead of being guessed later.
    const paymentTimeRate = await getUsdUzsRate().catch(() => null)

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
          if (
            existingPayment.shopId !== id
            || existingPayment.recordedById !== session.user.id
            || !sameMoney(existingPayment.amount, parsed.data.amount, existingPayment.currency)
            || existingPayment.months !== parsed.data.months
            || existingPayment.paymentMethod !== parsed.data.paymentMethod
            || !sameOptionalText(existingPayment.note, parsed.data.note)
          ) {
            throw {
              status: 409,
              message: "Idempotency-Key boshqa yoki o'zgartirilgan do'kon to'lovi uchun ishlatilgan",
            }
          }
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
        const packageVersion = await getActiveShopPackage(id, base, tx)
        if (!packageVersion) {
          throw { status: 409, message: "Do'konning faol paketi topilmadi" }
        }
        if (packageVersion.pricingNeedsReview) {
          throw { status: 409, message: "To'lovdan oldin do'kon paketining narxini tasdiqlang" }
        }
        const monthlyPrice = packageRecurringPrice(packageVersion).recurringPrice
        const expectedAmount = new Prisma.Decimal(monthlyPrice).mul(parsed.data.months).toDecimalPlaces(2)
        if (!sameMoney(expectedAmount, parsed.data.amount, packageVersion.currency)) {
          throw {
            status: 409,
            message: `Bu davr uchun to'lov ${expectedAmount.toString()} ${packageVersion.currency} bo'lishi kerak`,
          }
        }
        const servicePeriodStart = new Date(`${tashkentTodayInputValue(base)}T00:00:00.000Z`)
        const servicePeriodEnd = new Date(`${tashkentTodayInputValue(newDue)}T00:00:00.000Z`)
        const commandHash = createHash('sha256').update(JSON.stringify({
          shopId: id,
          recordedById: session.user.id,
          amount: expectedAmount.toString(),
          months: parsed.data.months,
          paymentMethod: parsed.data.paymentMethod,
          note: parsed.data.note?.trim() || null,
          packageVersionId: packageVersion.id,
          servicePeriodStart: servicePeriodStart.toISOString(),
          servicePeriodEnd: servicePeriodEnd.toISOString(),
          dueBefore: shop.subscriptionDue.toISOString(),
          dueAfter: newDue.toISOString(),
        })).digest('hex')
        const snapshots = buildShopPaymentSnapshots(parsed.data.amount, packageVersion.currency, paymentTimeRate)

        await tx.shopPayment.create({
          data: {
            shopId: id,
            amount: parsed.data.amount,
            months: parsed.data.months,
            paymentMethod: parsed.data.paymentMethod,
            note: parsed.data.note,
            idempotencyKey,
            recordedById: session.user.id,
            allocationStatus: 'PACKAGE_ALLOCATED',
            currency: packageVersion.currency,
            exchangeRateAtPayment: snapshots.exchangeRateAtPayment,
            amountUzsSnapshot: snapshots.amountUzsSnapshot,
            amountUsdSnapshot: snapshots.amountUsdSnapshot,
            currencyReconstructionStatus: snapshots.currencyReconstructionStatus,
            packageVersionId: packageVersion.id,
            packageMonthlyPriceSnapshot: monthlyPrice,
            servicePeriodStart,
            servicePeriodEnd,
            dueBefore: shop.subscriptionDue,
            dueAfter: newDue,
            commandHash,
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
              currency: packageVersion.currency,
              packageVersionId: packageVersion.id,
              packageMonthlyPriceSnapshot: monthlyPrice,
              servicePeriodStart,
              servicePeriodEnd,
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
        if (isRetryableTransactionError(err) && attempt < 2) {
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
      if (e.status === 409) return conflict(e.message)
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return serverError("Idempotency-Key bo'yicha to'lov allaqachon yozilgan. Iltimos, sahifani yangilang.")
    }
    logger.error('[POST /api/shops/[id]/payment]', { event: 'api.route_error', error: err })
    return serverError()
  }
}
