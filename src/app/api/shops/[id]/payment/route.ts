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
import { getStoredUsdUzsRateSnapshot } from '@/lib/server/currency'
import { buildShopPaymentSnapshots } from '@/lib/admin-money'
import { moneyMinorUnitsFromAmount, type CurrencyCode } from '@/lib/currency'

type RouteContext = { params: Promise<{ id: string }> }

function submittedAmountMinorUnits(amount: number, currency: CurrencyCode) {
  try {
    return moneyMinorUnitsFromAmount(amount, currency)
  } catch (error) {
    throw {
      status: 400,
      message: error instanceof Error ? error.message : "To'lov summasi noto'g'ri",
    }
  }
}

function storedAmountMatchesMinorUnits(
  storedAmount: unknown,
  submittedMinorUnits: number,
  currency: CurrencyCode,
) {
  try {
    return moneyMinorUnitsFromAmount(String(storedAmount), currency) === submittedMinorUnits
  } catch {
    return false
  }
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const guarded = await requireSuperAdmin()
    if (!guarded.ok) return guarded.response
    const { session } = guarded

    const { id } = await ctx.params
    const idempotencyKey = req.headers.get('idempotency-key')?.trim()
    if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 120) {
      return badRequest("Idempotency-Key sarlavhasi 8–120 belgidan iborat bo'lishi shart")
    }

    const body: unknown = await req.json()
    const parsed = addShopPaymentSchema.safeParse(body)

    if (!parsed.success) {
      const firstError = (parsed.error as ZodError).issues[0]?.message ?? "Noto'g'ri ma'lumot"
      return badRequest(firstError)
    }
    const submittedMinorUnits = submittedAmountMinorUnits(
      parsed.data.amount,
      parsed.data.expectedCurrency,
    )

    // A committed command is replayable without consulting today's FX quote
    // or package state. This keeps retries deterministic during provider
    // outages and after later package changes.
    const committedReplay = await prisma.shopPayment.findUnique({
      where: { shopId_idempotencyKey: { shopId: id, idempotencyKey } },
    })
    if (committedReplay) {
      if (
        committedReplay.recordedById !== session.user.id
        || committedReplay.currency !== parsed.data.expectedCurrency
        || !storedAmountMatchesMinorUnits(
          committedReplay.amount,
          submittedMinorUnits,
          committedReplay.currency,
        )
        || committedReplay.months !== parsed.data.months
        || committedReplay.paymentMethod !== parsed.data.paymentMethod
        || !sameOptionalText(committedReplay.note, parsed.data.note)
        || committedReplay.packageVersionId !== parsed.data.expectedPackageVersionId
        || !sameMoney(
          committedReplay.packageMonthlyPriceSnapshot,
          parsed.data.expectedMonthlyPrice,
          committedReplay.currency,
        )
      ) {
        return conflict("Idempotency-Key boshqa yoki o'zgartirilgan do'kon to'lovi uchun ishlatilgan")
      }
      const duplicateShop = await prisma.shop.findUnique({
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
      if (!duplicateShop) return notFound("Do'kon topilmadi")
      return ok(duplicateShop, "To'lov allaqachon qabul qilingan")
    }

    // Fetch once, before the serializable transaction. A missing rate does
    // not block a native-currency receipt; the opposite-currency reporting
    // snapshot is left explicitly PARTIAL instead of being guessed later.
    const paymentTimeQuote = await getStoredUsdUzsRateSnapshot()
    const paymentTimeRate = paymentTimeQuote?.rate ?? null

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
            || existingPayment.currency !== parsed.data.expectedCurrency
            || !storedAmountMatchesMinorUnits(
              existingPayment.amount,
              submittedMinorUnits,
              existingPayment.currency,
            )
            || existingPayment.months !== parsed.data.months
            || existingPayment.paymentMethod !== parsed.data.paymentMethod
            || !sameOptionalText(existingPayment.note, parsed.data.note)
            || existingPayment.packageVersionId !== parsed.data.expectedPackageVersionId
            || !sameMoney(
              existingPayment.packageMonthlyPriceSnapshot,
              parsed.data.expectedMonthlyPrice,
              existingPayment.currency,
            )
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
        const packageSubmittedMinorUnits = submittedAmountMinorUnits(
          parsed.data.amount,
          packageVersion.currency,
        )
        const monthlyPrice = packageRecurringPrice(packageVersion).recurringPrice
        if (
          packageVersion.id !== parsed.data.expectedPackageVersionId
          || packageVersion.currency !== parsed.data.expectedCurrency
          || !sameMoney(monthlyPrice, parsed.data.expectedMonthlyPrice, packageVersion.currency)
        ) {
          throw {
            status: 409,
            message: "Paket versiyasi, valyutasi yoki narxi o'zgargan. Ma'lumotni yangilab, qayta tekshiring.",
          }
        }
        const expectedAmount = new Prisma.Decimal(monthlyPrice).mul(parsed.data.months).toDecimalPlaces(2)
        const expectedAmountMinorUnits = moneyMinorUnitsFromAmount(
          expectedAmount.toString(),
          packageVersion.currency,
        )
        if (expectedAmountMinorUnits !== packageSubmittedMinorUnits) {
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
            exchangeRateSourceAtPayment: paymentTimeQuote?.source ?? null,
            exchangeRateEffectiveAtPayment: paymentTimeQuote?.effectiveAt ?? null,
            exchangeRateFetchedAtPayment: paymentTimeQuote?.fetchedAt ?? null,
            evidenceVersion: 2,
            evidenceStatus: 'CAPTURED',
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
      if (e.status === 400) return badRequest(e.message)
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
