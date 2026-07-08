import { NextRequest, after } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/generated/prisma/client'
import { requireApiSession, resolveActiveShopId } from '@/lib/api-auth'
import { addSalePaymentSchema } from '@/lib/validations'
import { ok, badRequest, notFound, conflict, serverError } from '@/lib/api-helpers'
import { processPendingNotifications } from '@/lib/notification-service'
import { salePaymentMessage } from '@/lib/telegram-templates'
import { logger } from '@/lib/logger'
import { invalidateShopPaymentMutation } from '@/lib/server/cache-tags'
import { moneyInputToUzs, moneyInputMeta } from '@/lib/server/money-input'
import { getShopCurrencyContext, getUsdUzsRate } from '@/lib/server/currency'
import { convertPaymentToContractCurrency, contractScheduleOutstanding } from '@/lib/nasiya-contract'
import type { ZodError } from 'zod'

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const guarded = await requireApiSession()
    if (!guarded.ok) return guarded.response
    const { session } = guarded

    const { id: saleId } = await ctx.params
    const body: unknown = await req.json()
    const parsed = addSalePaymentSchema.safeParse(body)

    if (!parsed.success) {
      const firstError = (parsed.error as ZodError).issues[0]?.message ?? "Noto'g'ri ma'lumot"
      return badRequest(firstError)
    }

    const idempotencyKey =
      req.headers.get('idempotency-key')?.trim() ||
      parsed.data.idempotencyKey?.trim()
    if (!idempotencyKey) {
      return badRequest('Idempotency-Key sarlavhasi kiritilishi shart')
    }

    const resolved = await resolveActiveShopId(session, (body as { shopId?: string }).shopId)
    if (!resolved.ok) return resolved.response
    const { shopId } = resolved
    const currency = await getShopCurrencyContext(shopId)
    let amountInput: Awaited<ReturnType<typeof moneyInputToUzs>>
    try {
      amountInput = await moneyInputToUzs(parsed.data.amount, parsed.data.inputCurrency)
    } catch (err) {
      return badRequest(err instanceof Error ? err.message : 'Valyuta kursi mavjud emas')
    }

    // Native contract-currency conversion — computed once, before the
    // transaction (same reasoning as the nasiya payment route: no slow I/O
    // held inside the serializable transaction). See docs/currency-accounting-model.md.
    const contractLookup = await prisma.sale.findFirst({ where: { id: saleId, shopId }, select: { contractCurrency: true } })
    const contractCurrency = contractLookup?.contractCurrency ?? 'UZS'
    let contractRate: number | null = amountInput.exchangeRateUsed
    if (amountInput.inputCurrency !== contractCurrency && contractRate == null) {
      try {
        contractRate = await getUsdUzsRate()
      } catch (err) {
        return badRequest(err instanceof Error ? err.message : 'Valyuta kursi mavjud emas')
      }
    }
    const appliedAmountInContractCurrency = convertPaymentToContractCurrency(
      parsed.data.amount,
      amountInput.inputCurrency,
      contractCurrency,
      contractRate,
    )

    const auditNote = parsed.data.reason?.trim() || parsed.data.note?.trim()
    const runPaymentTransaction = () => prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const existingPayment = await tx.salePayment.findUnique({
        where: { shopId_idempotencyKey: { shopId, idempotencyKey } },
      })
      if (existingPayment) {
        if (existingPayment.saleId !== saleId) {
          throw { status: 409, message: "Idempotency-Key boshqa sotuv to'lovi uchun ishlatilgan" }
        }
        return { payment: existingPayment, duplicate: true }
      }

      if (!auditNote) {
        throw {
          status: 400,
          message: "To'lov yozish yoki keyingi to'lov sanasini o'zgartirish uchun izoh yoki sabab kiritilishi shart",
        }
      }
      if (auditNote.length < 5) {
        throw {
          status: 400,
          message: "To'lov yoki keyingi to'lov sanasi sababi kamida 5 ta belgidan iborat bo'lishi kerak",
        }
      }

      const sale = await tx.sale.findFirst({
        where: { id: saleId, shopId, deletedAt: null },
        include: { device: true, customer: true, shop: { select: { name: true } } },
      })
      if (!sale) throw { status: 404, message: 'Sotuv topilmadi' }

      const oldRemaining = Number(sale.remainingAmount)
      // Both ledgers are checked — a sale should never be payable again once
      // EITHER its legacy or contract-currency balance says it's closed (see
      // the contract-currency completion fix below for why these two can, in
      // principle, disagree for a USD-native sale after a payment).
      if (oldRemaining <= 0 || sale.paidFully || contractScheduleOutstanding(Number(sale.contractSalePrice), Number(sale.contractAmountPaid), sale.contractCurrency) <= 0) {
        throw { status: 409, message: "Bu sotuv bo'yicha qarz yopilgan" }
      }

      const amount = amountInput.amountUzs
      if (amount > oldRemaining) {
        throw { status: 409, message: "To'lov qolgan qarzdan oshib ketdi" }
      }

      const paidAt = parsed.data.paidAt ?? new Date()
      const nextRemaining = oldRemaining - amount
      const nextAmountPaid = Number(sale.amountPaid) + amount
      // Native contract-currency mirror — dual-write alongside the legacy
      // UZS fields, same reasoning as the nasiya payment route. See
      // docs/currency-accounting-model.md.
      const nextContractAmountPaid = Number(sale.contractAmountPaid) + appliedAmountInContractCurrency
      // Completion is decided from the CONTRACT ledger, with a currency-aware
      // tolerance (500 so'm / $0.01) — never the legacy UZS remainder. A
      // USD-native sale's legacy remainingAmount is converted at whatever
      // rate was live on each individual payment's own day, so it can cross
      // zero at a different moment than the contract-currency balance —
      // deciding `paidFully` from the legacy side alone (the previous
      // behavior) could silently forgive real USD debt, or the reverse: keep
      // nagging a customer whose contract balance is genuinely settled. See
      // docs/currency-accounting-model.md and the nasiya payment route,
      // which already uses this exact pattern (`contractAllFullyPaid`).
      const nextContractRemaining = contractScheduleOutstanding(Number(sale.contractSalePrice), nextContractAmountPaid, sale.contractCurrency)
      const contractFullyPaid = nextContractRemaining <= 0
      // Snap the legacy remainder to exactly 0 in lockstep once the contract
      // side is done — clean bookkeeping instead of lingering rate-drift
      // dust, mirroring the nasiya payment route's remainingToStore.
      const remainingToStore = contractFullyPaid ? 0 : nextRemaining
      const payment = await tx.salePayment.create({
        data: {
          saleId,
          shopId,
          amount,
          paymentMethod: parsed.data.paymentMethod,
          paidAt,
          note: auditNote,
          idempotencyKey,
          createdBy: session.user.id,
          // What the customer actually entered, preserved for historical
          // display — see docs/currency-accounting-model.md.
          paymentInputAmount: parsed.data.amount,
          paymentInputCurrency: amountInput.inputCurrency,
          paymentExchangeRate: amountInput.exchangeRateUsed,
          appliedAmountInContractCurrency,
        },
      })

      const updatedSale = await tx.sale.update({
        where: { id: saleId },
        data: {
          amountPaid: nextAmountPaid,
          remainingAmount: remainingToStore,
          paidFully: contractFullyPaid,
          dueDate: contractFullyPaid ? null : parsed.data.nextDueDate ?? sale.dueDate,
          reminderEnabled: contractFullyPaid ? false : sale.reminderEnabled,
          contractAmountPaid: nextContractAmountPaid,
          contractRemainingAmount: nextContractRemaining,
        },
      })

      await tx.log.create({
        data: {
          shopId,
          actorId: session.user.id,
          actorType: session.user.role as 'SUPER_ADMIN' | 'SHOP_ADMIN',
          action: 'PAYMENT',
          targetType: 'Sale',
          targetId: saleId,
          oldValue: {
            amountPaid: sale.amountPaid,
            remainingAmount: sale.remainingAmount,
            paidFully: sale.paidFully,
            dueDate: sale.dueDate,
          },
          newValue: {
            paymentId: payment.id,
            amount,
            paymentMethod: parsed.data.paymentMethod,
            amountPaid: updatedSale.amountPaid,
            remainingAmount: updatedSale.remainingAmount,
            paidFully: updatedSale.paidFully,
            dueDate: updatedSale.dueDate,
            auditReason: auditNote,
            inputAmount: parsed.data.amount,
            ...moneyInputMeta(amountInput),
          },
          note: auditNote,
        },
      })

      // Notify all active shop admins with a verified telegramId.
      const shopAdmins = await tx.shopAdmin.findMany({
        where: { shopId, deletedAt: null, isActive: true, telegramId: { not: '' }, telegramVerifiedAt: { not: null } },
      })
      const paymentMessage = salePaymentMessage({
        shopName: sale.shop.name,
        customerName: sale.customer.name,
        customerPhone: sale.customer.phone,
        device: {
          deviceModel: sale.device.model,
          storage: sale.device.storage,
          color: sale.device.color,
          imei: sale.device.imei,
        },
        paidAmount: appliedAmountInContractCurrency,
        paymentMethod: parsed.data.paymentMethod,
        remaining: nextContractRemaining,
        contractCurrency,
        note: auditNote,
        paymentInput: { amount: parsed.data.amount, currency: amountInput.inputCurrency },
        adminName: session.user.name,
        currency,
      })
      for (const admin of shopAdmins) {
        await tx.notification.create({
          data: {
            shopId,
            type: 'PAYMENT_RECEIVED',
            message: paymentMessage,
            telegramId: admin.telegramId!,
            scheduledAt: new Date(),
            relatedId: saleId,
            relatedType: 'Sale',
          },
        })
      }

      return { payment, sale: updatedSale, duplicate: false }
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

    if (!result.duplicate) {
      invalidateShopPaymentMutation(shopId)
    }

    // Flush freshly-queued notifications after the response (non-blocking).
    // The rows are already committed, so cron is the backstop if this misses.
    after(() => processPendingNotifications().catch((e) => logger.warn('notification flush failed', { event: 'notification.flush_failed', error: e })))

    return ok(result, result.duplicate ? "To'lov allaqachon qabul qilingan" : "To'lov qabul qilindi")
  } catch (err: unknown) {
    if (typeof err === 'object' && err !== null && 'status' in err) {
      const e = err as { status: number; message: string }
      if (e.status === 400) return badRequest(e.message)
      if (e.status === 404) return notFound(e.message)
      if (e.status === 409) return conflict(e.message)
    }
    console.error('[POST /api/sales/[id]/payment]', err)
    return serverError()
  }
}
