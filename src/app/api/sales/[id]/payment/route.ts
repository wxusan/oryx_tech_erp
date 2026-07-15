import { NextRequest, after } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/generated/prisma/client'
import { requireShopPermissionAndFeature, resolveActiveShopId } from '@/lib/api-auth'
import { addSalePaymentSchema } from '@/lib/validations'
import { ok, badRequest, notFound, conflict, serverError, tooManyRequests } from '@/lib/api-helpers'
import { processPendingNotifications } from '@/lib/notification-service'
import { salePaymentMessage } from '@/lib/telegram-templates'
import { logger } from '@/lib/logger'
import { isRetryableTransactionError } from '@/lib/server/transaction-retry'
import { rateLimitKey } from '@/lib/rate-limit'
import { checkRateLimitDistributed } from '@/lib/rate-limit-adapter'
import { invalidateShopPaymentMutation } from '@/lib/server/cache-tags'
import { moneyInputToUzs, moneyInputMeta } from '@/lib/server/money-input'
import { getShopCurrencyContext, getUsdUzsRate } from '@/lib/server/currency'
import { convertPaymentToContractCurrency } from '@/lib/nasiya-contract'
import { applySalePaymentToContractLedger } from '@/lib/sale-contract-payment'
import { validatePaymentBreakdown, representativePaymentMethod } from '@/lib/payment-breakdown'
import type { ZodError } from 'zod'
import { presentDeviceSpecs } from '@/lib/device-specs'
import { canonicalPaymentBreakdown, sameInstant, sameMoney, sameOptionalText } from '@/lib/idempotency-replay'
import { allocateCumulativePaymentComponents, splitUzsReportingAmount } from '@/lib/payment-profit-allocation'

type RouteContext = { params: Promise<{ id: string }> }

type ExistingSalePaymentForReplay = {
  saleId: string
  amount: unknown
  paymentMethod: string
  paymentBreakdown: unknown
  paidAt: Date
  note: string | null
  paymentInputAmount: unknown | null
  paymentInputCurrency: 'UZS' | 'USD' | null
  paymentDateExplicit: boolean
  requestedNextDueDate: Date | null
}

function matchesExistingSalePaymentPayload(
  existing: ExistingSalePaymentForReplay,
  submitted: {
    saleId: string
    amount: number
    inputCurrency: 'UZS' | 'USD'
    paymentMethod: string
    paymentBreakdown: unknown
    paidAt?: Date
    nextDueDate?: Date
    note?: string
  },
) {
  if (existing.saleId !== submitted.saleId) return false
  const storedCurrency = existing.paymentInputCurrency ?? 'UZS'
  if (storedCurrency !== submitted.inputCurrency) return false
  if (!sameMoney(existing.paymentInputAmount ?? existing.amount, submitted.amount, storedCurrency)) return false
  if (existing.paymentMethod !== submitted.paymentMethod) return false
  if (
    canonicalPaymentBreakdown(existing.paymentBreakdown, storedCurrency)
    !== canonicalPaymentBreakdown(submitted.paymentBreakdown, submitted.inputCurrency)
  ) return false
  if (existing.paymentDateExplicit !== Boolean(submitted.paidAt)) return false
  if (submitted.paidAt && !sameInstant(existing.paidAt, submitted.paidAt)) return false
  if (!sameInstant(existing.requestedNextDueDate, submitted.nextDueDate)) return false
  return sameOptionalText(existing.note, submitted.note)
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const guarded = await requireShopPermissionAndFeature('SALE_PAYMENT_RECEIVE', 'CASH_SALES')
    if (!guarded.ok) return guarded.response
    const { session } = guarded

    const { id: saleId } = await ctx.params
    const body: unknown = await req.json()
    const parsed = addSalePaymentSchema.safeParse(body)

    if (!parsed.success) {
      const firstError = (parsed.error as ZodError).issues[0]?.message ?? "Noto'g'ri ma'lumot"
      return badRequest(firstError)
    }

    const idempotencyKey = req.headers.get('idempotency-key')?.trim() || parsed.data.idempotencyKey?.trim()
    if (!idempotencyKey) {
      return badRequest('Idempotency-Key sarlavhasi kiritilishi shart')
    }

    // Item 12 — split payment (e.g. half cash, half card). Parts must sum
    // to the payment amount; the existing paymentMethod field stays
    // populated with a representative value so no existing reader breaks.
    if (parsed.data.paymentBreakdown) {
      const breakdownError = validatePaymentBreakdown(
        parsed.data.paymentBreakdown,
        parsed.data.amount,
        parsed.data.inputCurrency ?? 'UZS',
      )
      if (breakdownError) return badRequest(breakdownError)
    }
    const effectivePaymentMethod = parsed.data.paymentBreakdown
      ? representativePaymentMethod(parsed.data.paymentBreakdown)
      : parsed.data.paymentMethod

    const resolved = await resolveActiveShopId(session, (body as { shopId?: string }).shopId)
    if (!resolved.ok) return resolved.response
    const { shopId } = resolved

    // Distributed when Upstash is configured; bounded in-process fallback otherwise.
    const rate = await checkRateLimitDistributed(rateLimitKey('sale-payment', shopId, session.user.id), { windowMs: 60_000, max: 20 })
    if (!rate.allowed) return tooManyRequests(rate.retryAfterSeconds)

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
    const contractLookup = await prisma.sale.findFirst({
      where: { id: saleId, shopId, deletedAt: null, returnedAt: null },
      select: { contractCurrency: true },
    })
    const contractCurrency = contractLookup?.contractCurrency ?? 'UZS'
    let contractRate: number | null = amountInput.exchangeRateUsed
    if (amountInput.inputCurrency !== contractCurrency && contractRate == null) {
      try {
        contractRate = await getUsdUzsRate()
      } catch (err) {
        return badRequest(err instanceof Error ? err.message : 'Valyuta kursi mavjud emas')
      }
    }
    const requestedAppliedAmountInContractCurrency = convertPaymentToContractCurrency(
      parsed.data.amount,
      amountInput.inputCurrency,
      contractCurrency,
      contractRate,
    )

    // Optional ordinary comments are normalized to `undefined` so a blank
    // textarea is stored as NULL rather than an ambiguous empty audit note.
    const auditNote = parsed.data.reason?.trim() || parsed.data.note?.trim() || undefined
    const runPaymentTransaction = () =>
      prisma.$transaction(
        async (tx: Prisma.TransactionClient) => {
          const existingPayment = await tx.salePayment.findUnique({
            where: { shopId_idempotencyKey: { shopId, idempotencyKey } },
          })
          if (existingPayment) {
            if (!matchesExistingSalePaymentPayload(existingPayment, {
              saleId,
              amount: parsed.data.amount,
              inputCurrency: amountInput.inputCurrency,
              paymentMethod: effectivePaymentMethod,
              paymentBreakdown: parsed.data.paymentBreakdown,
              paidAt: parsed.data.paidAt,
              nextDueDate: parsed.data.nextDueDate,
              note: auditNote,
            })) {
              throw {
                status: 409,
                message: "Idempotency-Key boshqa yoki o'zgartirilgan sotuv to'lovi uchun ishlatilgan",
              }
            }
            return { payment: existingPayment, duplicate: true }
          }

          const sale = await tx.sale.findFirst({
            where: { id: saleId, shopId, deletedAt: null, returnedAt: null },
            include: {
              device: { include: { imeis: { where: { deletedAt: null } } } },
              customer: true,
              shop: { select: { name: true } },
            },
          })
          if (!sale) throw { status: 404, message: 'Sotuv topilmadi' }

          // Contract fields decide whether a debt is payable and whether this
          // payment fits. Legacy UZS fields below are compatibility snapshots
          // only: an FX-rate change can make their remaining value smaller or
          // larger than the real contract debt.
          const contractPayment = applySalePaymentToContractLedger({
            contractCurrency: sale.contractCurrency,
            contractSalePrice: Number(sale.contractSalePrice),
            contractAmountPaid: Number(sale.contractAmountPaid),
            contractRemainingAmount: Number(sale.contractRemainingAmount),
            appliedAmountInContractCurrency: requestedAppliedAmountInContractCurrency,
          })
          if (!contractPayment.accepted) {
            if (contractPayment.reason === 'ALREADY_SETTLED') {
              throw { status: 409, message: "Bu sotuv bo'yicha qarz yopilgan" }
            }
            if (contractPayment.reason === 'OVERPAYMENT') {
              throw { status: 409, message: "To'lov qolgan shartnoma qarzidan oshib ketdi" }
            }
            throw { status: 400, message: "To'lov summasi noto'g'ri" }
          }

          const oldRemaining = Number(sale.remainingAmount)
          const amount = amountInput.amountUzs
          const paidAt = parsed.data.paidAt ?? new Date()
          // Legacy UZS figures are updated only after contract acceptance.
          // They may drift under FX movement, but must stay non-negative and
          // snap to zero once the native debt is genuinely settled.
          const nextRemaining = Math.max(0, oldRemaining - amount)
          const nextAmountPaid = Number(sale.amountPaid) + amount
          const remainingToStore = contractPayment.isFullyPaid ? 0 : nextRemaining
          const componentResult = ['COMPLETE', 'PARTIAL'].includes(sale.accountingReconstructionStatus)
            ? allocateCumulativePaymentComponents({
                currency: sale.contractCurrency,
                totals: {
                  principal: Number(sale.contractCostBasisAmount),
                  margin: Number(sale.contractMarginAmount),
                  interest: 0,
                },
                paid: {
                  principal: Number(sale.contractPrincipalPaidAmount),
                  margin: Number(sale.contractMarginPaidAmount),
                  interest: 0,
                },
                paymentAmount: contractPayment.appliedAmountInContractCurrency,
              })
            : null
          const reportingComponents = componentResult
            ? splitUzsReportingAmount({
                amountUzs: amount,
                contractAmount: contractPayment.appliedAmountInContractCurrency,
                contractComponents: componentResult.allocation,
              })
            : null
          const payment = await tx.salePayment.create({
            data: {
              saleId,
              shopId,
              amount,
              paymentMethod: effectivePaymentMethod,
              paymentBreakdown: parsed.data.paymentBreakdown ?? undefined,
              paidAt,
              note: auditNote,
              idempotencyKey,
              createdBy: session.user.id,
              // What the customer actually entered, preserved for historical
              // display — see docs/currency-accounting-model.md.
              paymentInputAmount: parsed.data.amount,
              paymentInputCurrency: amountInput.inputCurrency,
              paymentExchangeRate: contractRate,
              appliedAmountInContractCurrency: contractPayment.appliedAmountInContractCurrency,
              paymentDateExplicit: parsed.data.paidAt !== undefined,
              requestedNextDueDate: parsed.data.nextDueDate,
              contractPrincipalAmount: componentResult?.allocation.principal ?? 0,
              contractMarginAmount: componentResult?.allocation.margin ?? 0,
              principalAmountUzs: reportingComponents?.principal ?? 0,
              marginAmountUzs: reportingComponents?.margin ?? 0,
            },
          })

          const updatedSale = await tx.sale.update({
            where: { id: saleId },
            data: {
              amountPaid: nextAmountPaid,
              remainingAmount: remainingToStore,
              paidFully: contractPayment.isFullyPaid,
              dueDate: contractPayment.isFullyPaid ? null : (parsed.data.nextDueDate ?? sale.dueDate),
              reminderEnabled: contractPayment.isFullyPaid ? false : sale.reminderEnabled,
              contractAmountPaid: contractPayment.newContractAmountPaid,
              contractRemainingAmount: contractPayment.newContractRemainingAmount,
              ...(componentResult ? {
                contractPrincipalPaidAmount: componentResult.paidAfter.principal,
                contractMarginPaidAmount: componentResult.paidAfter.margin,
              } : {}),
            },
          })

          const nextDeviceStatus =
            contractPayment.isFullyPaid && sale.device.status === 'SOLD_DEBT'
              ? 'SOLD_CASH'
              : sale.device.status
          if (nextDeviceStatus !== sale.device.status) {
            await tx.device.update({
              where: { id: sale.deviceId },
              data: { status: nextDeviceStatus, updatedAt: new Date() },
            })
          }

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
                deviceStatus: sale.device.status,
              },
              newValue: {
                paymentId: payment.id,
                amount,
                paymentMethod: effectivePaymentMethod,
                paymentBreakdown: parsed.data.paymentBreakdown,
                amountPaid: updatedSale.amountPaid,
                remainingAmount: updatedSale.remainingAmount,
                paidFully: updatedSale.paidFully,
                contractAmountPaid: updatedSale.contractAmountPaid,
                contractRemainingAmount: updatedSale.contractRemainingAmount,
                appliedAmountInContractCurrency: contractPayment.appliedAmountInContractCurrency,
                dueDate: updatedSale.dueDate,
                deviceStatus: nextDeviceStatus,
                ...(auditNote ? { auditReason: auditNote } : {}),
                inputAmount: parsed.data.amount,
                ...moneyInputMeta(amountInput),
              },
              note: auditNote,
            },
          })

          // Notify all active shop admins with a verified telegramId.
          const shopAdmins = await tx.shopAdmin.findMany({
            where: {
              shopId,
              deletedAt: null,
              isActive: true,
              telegramId: { not: '' },
              telegramVerifiedAt: { not: null },
            },
          })
          const paymentMessage = salePaymentMessage({
            shopName: sale.shop.name,
            customerName: sale.customer.name,
            customerPhone: sale.customer.phone,
            device: presentDeviceSpecs(sale.device),
            paidAmount: contractPayment.appliedAmountInContractCurrency,
            paymentMethod: effectivePaymentMethod,
            paymentBreakdown: parsed.data.paymentBreakdown,
            remaining: contractPayment.newContractRemainingAmount,
            contractCurrency: sale.contractCurrency,
            note: auditNote,
            paymentInput: {
              amount: parsed.data.amount,
              currency: amountInput.inputCurrency,
            },
            paymentExchangeRate: contractRate,
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
                recipientShopAdminId: admin.id,
                scheduledAt: new Date(),
                relatedId: saleId,
                relatedType: 'Sale',
              },
            })
          }

          return { payment, sale: updatedSale, duplicate: false }
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      )

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

    if (!result.duplicate) {
      invalidateShopPaymentMutation(shopId)
    }

    // Flush freshly-queued notifications after the response (non-blocking).
    // The rows are already committed, so cron is the backstop if this misses.
    after(() =>
      processPendingNotifications().catch((e) =>
        logger.warn('notification flush failed', {
          event: 'notification.flush_failed',
          error: e,
        }),
      ),
    )

    return ok(result, result.duplicate ? "To'lov allaqachon qabul qilingan" : "To'lov qabul qilindi")
  } catch (err: unknown) {
    if (typeof err === 'object' && err !== null && 'status' in err) {
      const e = err as { status: number; message: string }
      if (e.status === 400) return badRequest(e.message)
      if (e.status === 404) return notFound(e.message)
      if (e.status === 409) return conflict(e.message)
    }
    logger.error('[POST /api/sales/[id]/payment]', {
      event: 'api.route_error',
      error: err,
    })
    return serverError()
  }
}
