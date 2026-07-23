/**
 * POST /api/devices/[id]/sell — mark a device as sold (cash sale)
 *
 * Validates device is IN_STOCK, creates Sale + Customer, updates device status,
 * creates a Notification, and logs the action — all in a single transaction.
 */

import { NextRequest, after } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/generated/prisma/client'
import { requireShopPermission, resolveActiveShopId } from '@/lib/api-auth'
import { createSaleSchema } from '@/lib/validations'
import { created, badRequest, notFound, conflict, serverError, tooManyRequests } from '@/lib/api-helpers'
import { flushQueuedTelegramWork } from '@/lib/notification-service'
import { deviceSoldMessage } from '@/lib/telegram-templates'
import { logger } from '@/lib/logger'
import { rateLimitKey } from '@/lib/rate-limit'
import { checkRateLimitDistributed } from '@/lib/rate-limit-adapter'
import { invalidateShopSaleMutation } from '@/lib/server/cache-tags'
import { CustomerSelectionError, resolveCustomerSelection } from '@/lib/server/customer-selection'
import { createMoneyInputConverter, moneyInputMeta, type MoneyInputResult } from '@/lib/server/money-input'
import { getShopCurrencyContext } from '@/lib/server/currency'
import { roundContractMoney, computeSaleContractMargin } from '@/lib/nasiya-contract'
import type { ZodError } from 'zod'
import { presentDeviceSpecs } from '@/lib/device-specs'
import { allocateCumulativePaymentComponents, buildSaleComponentPlan, splitUzsReportingAmount } from '@/lib/payment-profit-allocation'
import { createHash } from 'node:crypto'
import { resolveTelegramRecipients, telegramNotificationRows, telegramUnavailableMarkerRows, TELEGRAM_AUDIENCES } from '@/lib/server/telegram-recipients'

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const guarded = await requireShopPermission('SALE_CREATE')
    if (!guarded.ok) return guarded.response
    const { session } = guarded

    const { id: deviceId } = await ctx.params
    const idempotencyKey = req.headers.get('idempotency-key')?.trim() || null
    if (idempotencyKey && (idempotencyKey.length < 8 || idempotencyKey.length > 120)) {
      return badRequest("Idempotency-Key sarlavhasi 8–120 belgidan iborat bo'lishi shart")
    }
    const body: unknown = await req.json()
    const parsed = createSaleSchema.safeParse(body)

    if (!parsed.success) {
      const firstError = (parsed.error as ZodError).issues[0]?.message ?? "Noto'g'ri ma'lumot"
      return badRequest(firstError)
    }

    const {
      customerMode, customerId, customerName, customerPhone,
      salePrice, paymentMethod,
      paidFully, amountPaid,
      dueDate, reminderEnabled, note,
      earlyReminderEnabled, earlyReminderDays,
    } = parsed.data

    // Derive shopId — shop admins are scoped to their shop.
    const resolved = await resolveActiveShopId(session, (body as { shopId?: string }).shopId)
    if (!resolved.ok) return resolved.response
    const { shopId } = resolved

    // Distributed when Upstash is configured; bounded in-process fallback otherwise.
    const rate = await checkRateLimitDistributed(rateLimitKey('device-sell', shopId, session.user.id), { windowMs: 60_000, max: 20 })
    if (!rate.allowed) return tooManyRequests(rate.retryAfterSeconds)

    const currency = await getShopCurrencyContext(shopId)
    let salePriceInput: MoneyInputResult
    let amountPaidInput: MoneyInputResult | null = null
    try {
      const convertMoney = await createMoneyInputConverter(parsed.data.inputCurrency)
      salePriceInput = convertMoney(salePrice)
      if (amountPaid !== undefined) amountPaidInput = convertMoney(amountPaid)
    } catch (err) {
      return badRequest(err instanceof Error ? err.message : 'Valyuta kursi mavjud emas')
    }
    const salePriceUzs = salePriceInput.amountUzs
    const amountPaidUzs = amountPaidInput?.amountUzs

    // Native contract-currency ledger — computed from the RAW input (not
    // UZS-converted), in the currency the sale was actually made in. See
    // docs/currency-accounting-model.md.
    const contractCurrency = salePriceInput.inputCurrency
    const contractSalePrice = roundContractMoney(salePrice, contractCurrency)
    const contractAmountPaidInput = amountPaid !== undefined ? roundContractMoney(amountPaid, contractCurrency) : undefined
    const paid = paidFully ? salePriceUzs : amountPaidUzs ?? 0
    const remaining = salePriceUzs - paid
    const contractPaid = paidFully ? contractSalePrice : contractAmountPaidInput ?? 0
    const contractRemaining = contractSalePrice - contractPaid
    const nextDeviceStatus = contractRemaining > 0 ? 'SOLD_DEBT' : 'SOLD_CASH'
    if (paid > 0 && !paymentMethod) return badRequest("Pul qabul qilinganda to'lov usuli kiritilishi shart")
    const commandHash = idempotencyKey
      ? createHash('sha256').update(JSON.stringify({
          deviceId,
          customerMode,
          customerId: customerId ?? null,
          customerName: customerName ?? null,
          customerPhone: customerPhone ?? null,
          salePrice,
          inputCurrency: parsed.data.inputCurrency ?? null,
          paymentMethod: paid > 0 ? paymentMethod : null,
          paidFully,
          amountPaid: amountPaid ?? null,
          dueDate: dueDate?.toISOString() ?? null,
          reminderEnabled: reminderEnabled ?? false,
          earlyReminderEnabled: earlyReminderEnabled ?? false,
          earlyReminderDays: earlyReminderDays ?? null,
          note: note ?? null,
        })).digest('hex')
      : null

    const runTransaction = () => prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      if (idempotencyKey) {
        const replay = await tx.sale.findUnique({
          where: { shopId_creationIdempotencyKey: { shopId, creationIdempotencyKey: idempotencyKey } },
        })
        if (replay) {
          if (replay.creationCommandHash !== commandHash || replay.deviceId !== deviceId || replay.createdBy !== session.user.id) {
            throw { status: 409, message: "Idempotency-Key boshqa yoki o'zgartirilgan sotuv uchun ishlatilgan" }
          }
          return { sale: replay, duplicate: true }
        }
      }

      const device = await tx.device.findFirst({
        where: { id: deviceId, shopId, deletedAt: null },
        include: { shop: { select: { name: true } }, imeis: { where: { deletedAt: null } } },
      })

      if (!device) throw { status: 404, message: "Qurilma topilmadi" }
      if (device.status !== 'IN_STOCK') throw { status: 409, message: "Qurilma sotishga tayyor emas" }

      const contractMarginAmount = computeSaleContractMargin(
        contractSalePrice,
        contractCurrency,
        salePriceInput.exchangeRateUsed,
        {
          purchaseCurrency: device.purchaseCurrency,
          purchaseInputAmount: Number(device.purchaseInputAmount),
          purchaseAmountUzsSnapshot: Number(device.purchaseAmountUzsSnapshot),
        },
      )
      if (contractMarginAmount === null) {
        throw { status: 409, message: "Qurilma tannarxini shartnoma valyutasida aniq ajratib bo'lmadi" }
      }
      const componentPlan = buildSaleComponentPlan({
        currency: contractCurrency,
        salePrice: contractSalePrice,
        costBasisAmount: contractSalePrice - contractMarginAmount,
      })
      const initialComponents = contractPaid > 0
        ? allocateCumulativePaymentComponents({
            currency: contractCurrency,
            totals: componentPlan,
            paid: { principal: 0, margin: 0, interest: 0 },
            paymentAmount: contractPaid,
          })
        : null

      const reserved = await tx.device.updateMany({
        where: { id: deviceId, shopId, deletedAt: null, status: 'IN_STOCK' },
        data: { status: nextDeviceStatus, updatedAt: new Date() },
      })
      if (reserved.count !== 1) throw { status: 409, message: "Qurilma allaqachon sotilgan" }

      const customer = await resolveCustomerSelection(tx, {
        shopId,
        mode: customerMode,
        customerId,
        customerName,
        customerPhone,
      })

      const sale = await tx.sale.create({
        data: {
          shopId,
          deviceId,
          customerId: customer.id,
          salePrice: salePriceUzs,
          paymentMethod: paid > 0 ? paymentMethod : null,
          paidFully: remaining <= 0,
          amountPaid: paid,
          remainingAmount: remaining,
          dueDate,
          reminderEnabled: reminderEnabled ?? false,
          earlyReminderEnabled: earlyReminderEnabled ?? false,
          earlyReminderDays: earlyReminderEnabled ? earlyReminderDays : null,
          note,
          createdBy: session.user.id,
          // Informational only — see docs/currency-accounting-model.md.
          creationCurrency: salePriceInput.inputCurrency,
          creationExchangeRate: salePriceInput.exchangeRateUsed,
          // Native contract-currency ledger — source of truth going forward.
          contractCurrency,
          contractExchangeRateAtCreation: salePriceInput.exchangeRateUsed,
          contractSalePrice,
          contractAmountPaid: contractPaid,
          contractRemainingAmount: contractRemaining,
          contractCostBasisAmount: componentPlan.principal,
          contractMarginAmount: componentPlan.margin,
          contractPrincipalPaidAmount: initialComponents?.paidAfter.principal ?? 0,
          contractMarginPaidAmount: initialComponents?.paidAfter.margin ?? 0,
          accountingReconstructionStatus: 'COMPLETE',
          accountingReconstructedAt: new Date(),
          creationIdempotencyKey: idempotencyKey,
          creationCommandHash: commandHash,
        },
      })

      if (paid > 0) {
        const reportingComponents = splitUzsReportingAmount({
          amountUzs: paid,
          contractAmount: contractPaid,
          contractComponents: initialComponents!.allocation,
        })
        await tx.salePayment.create({
          data: {
            saleId: sale.id,
            shopId,
            amount: paid,
            paymentMethod: paymentMethod!,
            paidAt: new Date(),
            note: remaining > 0 ? "Boshlang'ich to'lov" : "To'liq to'lov",
            paymentInputAmount: paidFully ? salePrice : amountPaid,
            paymentInputCurrency: salePriceInput.inputCurrency,
            paymentExchangeRate: salePriceInput.exchangeRateUsed,
            appliedAmountInContractCurrency: contractPaid,
            contractPrincipalAmount: initialComponents!.allocation.principal,
            contractMarginAmount: initialComponents!.allocation.margin,
            principalAmountUzs: reportingComponents.principal,
            marginAmountUzs: reportingComponents.margin,
            idempotencyKey: `sale-initial:${sale.id}`,
            createdBy: session.user.id,
          },
        })
      }

      // This template includes profit; only the shop owner may receive it.
      const recipients = await resolveTelegramRecipients(tx, {
        shopId,
        audience: TELEGRAM_AUDIENCES.OWNER_ONLY,
      })
      const scheduledAt = new Date()
      const notificationRows = [
        ...telegramNotificationRows(recipients, {
          type: 'SALE',
          message: deviceSoldMessage({
          shopName: device.shop.name,
          device: presentDeviceSpecs(device),
          customerName: customer.name,
          customerPhone: customer.phone,
          salePrice: contractSalePrice,
          paidAmount: contractPaid,
          remaining: contractRemaining,
          contractCurrency,
          paymentMethod,
          adminName: session.user.name,
          currency,
          // Item 14 — sale margin, shown when computable (never guessed).
          profit: contractMarginAmount,
          }),
          scheduledAt,
          relatedId: sale.id,
          relatedType: 'Sale',
        }),
        ...telegramUnavailableMarkerRows(recipients, {
          type: 'SALE',
          dedupeScope: sale.id,
          cancelledAt: scheduledAt,
        }),
      ]
      if (notificationRows.length > 0) await tx.notification.createMany({ data: notificationRows })

      await tx.log.create({
        data: {
          shopId,
          actorId: session.user.id,
          actorType: session.user.role as 'SUPER_ADMIN' | 'SHOP_ADMIN',
          action: 'SELL',
          targetType: 'Device',
          targetId: deviceId,
          newValue: {
            salePrice: salePriceUzs,
            inputAmount: salePrice,
            customerId: customer.id,
            customerName: customer.name,
            paymentMethod,
            amountPaid: paid,
            remainingAmount: remaining,
            dueDate,
            paidFully: remaining <= 0,
            deviceStatus: nextDeviceStatus,
            ...moneyInputMeta(salePriceInput),
          },
        },
      })

      return { sale, duplicate: false }
    })

    let result: Awaited<ReturnType<typeof runTransaction>>
    try {
      result = await runTransaction()
    } catch (error) {
      if (idempotencyKey && error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const replay = await prisma.sale.findUnique({
          where: { shopId_creationIdempotencyKey: { shopId, creationIdempotencyKey: idempotencyKey } },
        })
        if (replay && replay.creationCommandHash === commandHash && replay.deviceId === deviceId && replay.createdBy === session.user.id) {
          result = { sale: replay, duplicate: true }
        } else {
          throw { status: 409, message: "Idempotency-Key boshqa yoki o'zgartirilgan sotuv uchun ishlatilgan" }
        }
      } else {
        throw error
      }
    }

    if (!result.duplicate) invalidateShopSaleMutation(shopId)

    // Flush freshly-queued notifications after the response (non-blocking).
    // The rows are already committed, so cron is the backstop if this misses.
    if (!result.duplicate) {
      after(() => flushQueuedTelegramWork().catch((e) => logger.warn('notification flush failed', { event: 'notification.flush_failed', error: e })))
    }

    return created(result.sale, result.duplicate ? 'Bu sotuv avval saqlangan' : "Qurilma muvaffaqiyatli sotildi")
  } catch (err: unknown) {
    if (err instanceof CustomerSelectionError) {
      if (err.status === 404) return notFound(err.message)
      if (err.status === 409) return conflict(err.message)
      return badRequest(err.message)
    }
    if (typeof err === 'object' && err !== null && 'status' in err) {
      const e = err as { status: number; message: string }
      if (e.status === 404) return notFound(e.message)
      if (e.status === 409) return conflict(e.message)
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return conflict('Bu telefon bilan faol mijoz mavjud. Uni qidiruvdan tanlang; mijozlar avtomatik birlashtirilmaydi.')
    }
    logger.error('[POST /api/devices/[id]/sell]', { event: 'api.route_error', error: err })
    return serverError()
  }
}
