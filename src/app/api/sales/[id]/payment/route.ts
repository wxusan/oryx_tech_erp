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
import { getShopCurrencyContext } from '@/lib/server/currency'
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
      if (oldRemaining <= 0 || sale.paidFully) {
        throw { status: 409, message: "Bu sotuv bo'yicha qarz yopilgan" }
      }

      const amount = amountInput.amountUzs
      if (amount > oldRemaining) {
        throw { status: 409, message: "To'lov qolgan qarzdan oshib ketdi" }
      }

      const paidAt = parsed.data.paidAt ?? new Date()
      const nextRemaining = oldRemaining - amount
      const nextAmountPaid = Number(sale.amountPaid) + amount
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
        },
      })

      const updatedSale = await tx.sale.update({
        where: { id: saleId },
        data: {
          amountPaid: nextAmountPaid,
          remainingAmount: nextRemaining,
          paidFully: nextRemaining <= 0,
          dueDate: nextRemaining <= 0 ? null : parsed.data.nextDueDate ?? sale.dueDate,
          reminderEnabled: nextRemaining <= 0 ? false : sale.reminderEnabled,
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
        paidAmount: amount,
        paymentMethod: parsed.data.paymentMethod,
        remaining: nextRemaining,
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
