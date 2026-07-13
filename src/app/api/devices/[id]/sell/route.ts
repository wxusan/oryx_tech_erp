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
import { processPendingNotifications } from '@/lib/notification-service'
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

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const guarded = await requireShopPermission('CASH_SALE_CREATE')
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

    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const device = await tx.device.findFirst({
        where: { id: deviceId, shopId, deletedAt: null },
        include: { shop: { select: { name: true } }, imeis: { where: { deletedAt: null } } },
      })

      if (!device) throw { status: 404, message: "Qurilma topilmadi" }
      if (device.status !== 'IN_STOCK') throw { status: 409, message: "Qurilma sotishga tayyor emas" }

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
          paymentMethod: parsed.data.paymentMethod,
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
            paymentInputAmount: paidFully ? salePrice : amountPaid,
            paymentInputCurrency: salePriceInput.inputCurrency,
            paymentExchangeRate: salePriceInput.exchangeRateUsed,
            appliedAmountInContractCurrency: contractPaid,
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
              profit: computeSaleContractMargin(contractSalePrice, contractCurrency, salePriceInput.exchangeRateUsed, {
                purchaseCurrency: device.purchaseCurrency,
                purchaseInputAmount: Number(device.purchaseInputAmount),
                purchaseAmountUzsSnapshot: Number(device.purchaseAmountUzsSnapshot),
              }),
            }),
            telegramId: admin.telegramId!,
            recipientShopAdminId: admin.id,
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

      return sale
    })

    invalidateShopSaleMutation(shopId)

    // Flush freshly-queued notifications after the response (non-blocking).
    // The rows are already committed, so cron is the backstop if this misses.
    after(() => processPendingNotifications().catch((e) => logger.warn('notification flush failed', { event: 'notification.flush_failed', error: e })))

    return created(result, "Qurilma muvaffaqiyatli sotildi")
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
