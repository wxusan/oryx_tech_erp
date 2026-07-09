/**
 * POST /api/nasiya/[id]/payment — record a payment against a nasiya schedule entry
 *
 * [id] here is the nasiya ID (not schedule ID — the schedule to pay is in the body).
 *
 * Updates the NasiyaSchedule row, recalculates nasiya totals,
 * marks nasiya as COMPLETED if fully paid, creates a notification, and logs.
 */

import { NextRequest, after } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/generated/prisma/client'
import { requireApiSession, resolveActiveShopId } from '@/lib/api-auth'
import { addNasiyaPaymentSchema } from '@/lib/validations'
import { calculateRemaining, isScheduleOverdue } from '@/lib/nasiya-utils'
import { convertPaymentToContractCurrency, contractScheduleOutstanding } from '@/lib/nasiya-contract'
import { allocateNasiyaPayment, totalContractOutstanding } from '@/lib/nasiya-payment-allocation'
import { ok, badRequest, notFound, conflict, serverError, tooManyRequests } from '@/lib/api-helpers'
import { processPendingNotifications } from '@/lib/notification-service'
import { nasiyaPaymentMessage, nasiyaCompletedMessage } from '@/lib/telegram-templates'
import { logger } from '@/lib/logger'
import { rateLimitKey } from '@/lib/rate-limit'
import { checkRateLimitDistributed } from '@/lib/rate-limit-adapter'
import { invalidateShopPaymentMutation } from '@/lib/server/cache-tags'
import { moneyInputToUzs, moneyInputMeta } from '@/lib/server/money-input'
import { getShopCurrencyContext, getUsdUzsRate } from '@/lib/server/currency'
import { validatePaymentBreakdown, representativePaymentMethod } from '@/lib/payment-breakdown'
import type { ZodError } from 'zod'

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const guarded = await requireApiSession()
    if (!guarded.ok) return guarded.response
    const { session } = guarded

    const { id: nasiyaId } = await ctx.params
    const body: unknown = await req.json()
    const parsed = addNasiyaPaymentSchema.safeParse(body)

    if (!parsed.success) {
      const firstError = (parsed.error as ZodError).issues[0]?.message ?? "Noto'g'ri ma'lumot"
      return badRequest(firstError)
    }

    const {
      nasiyaScheduleId,
      amount,
      paymentMethod,
      paymentBreakdown,
      date,
      delayedUntil,
      note,
      deferredToNext,
    } = parsed.data
    const idempotencyKey = req.headers.get('idempotency-key')?.trim()
    if ((amount > 0 || deferredToNext) && !idempotencyKey) {
      return badRequest('Idempotency-Key sarlavhasi kiritilishi shart')
    }

    // Item 12 — split payment (e.g. half cash, half card). Parts must sum
    // to the payment amount; the existing paymentMethod field stays
    // populated with a representative value so no existing reader breaks.
    if (paymentBreakdown) {
      const breakdownError = validatePaymentBreakdown(paymentBreakdown, amount)
      if (breakdownError) return badRequest(breakdownError)
    }
    const effectivePaymentMethod = paymentBreakdown ? representativePaymentMethod(paymentBreakdown) : paymentMethod

    const resolved = await resolveActiveShopId(session, (body as { shopId?: string }).shopId)
    if (!resolved.ok) return resolved.response
    const { shopId } = resolved

    // Per-instance abuse guard (not distributed — see src/lib/rate-limit.ts).
    const rate = await checkRateLimitDistributed(rateLimitKey('nasiya-payment', shopId, session.user.id), { windowMs: 60_000, max: 20 })
    if (!rate.allowed) return tooManyRequests(rate.retryAfterSeconds)

    const currency = await getShopCurrencyContext(shopId)
    const auditNote = note?.trim()
    let amountInput: Awaited<ReturnType<typeof moneyInputToUzs>>
    try {
      amountInput = amount > 0
        ? await moneyInputToUzs(amount, parsed.data.inputCurrency)
        : { amountUzs: 0, inputCurrency: parsed.data.inputCurrency ?? 'UZS', exchangeRateUsed: null }
    } catch (err) {
      return badRequest(err instanceof Error ? err.message : 'Valyuta kursi mavjud emas')
    }
    const amountUzs = amountInput.amountUzs

    // Native contract-currency conversion — computed once, before the
    // transaction, same reasoning as amountInput above (no slow I/O held
    // inside the serializable transaction). A cheap pre-read of just the
    // nasiya's (immutable) contractCurrency is enough; the transaction below
    // still loads the authoritative nasiya row for everything else.
    let contractCurrency: 'UZS' | 'USD' = 'UZS'
    let contractRate: number | null = amountInput.exchangeRateUsed
    let appliedAmountInContractCurrency = 0
    if (amountUzs > 0) {
      const contractLookup = await prisma.nasiya.findFirst({
        where: { id: nasiyaId, shopId },
        select: { contractCurrency: true },
      })
      contractCurrency = contractLookup?.contractCurrency ?? 'UZS'
      if (amountInput.inputCurrency !== contractCurrency && contractRate == null) {
        try {
          contractRate = await getUsdUzsRate()
        } catch (err) {
          return badRequest(err instanceof Error ? err.message : 'Valyuta kursi mavjud emas')
        }
      }
      appliedAmountInContractCurrency = convertPaymentToContractCurrency(
        amount,
        amountInput.inputCurrency,
        contractCurrency,
        contractRate,
      )
    }

    const runPaymentTransaction = () => prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Verify nasiya exists and belongs to this shop
      const nasiya = await tx.nasiya.findFirst({
        where: { id: nasiyaId, shopId, deletedAt: null, status: { not: 'CANCELLED' } },
        include: {
          schedules: true,
          shop: { select: { name: true } },
          customer: { select: { name: true, phone: true } },
          device: { select: { model: true, storage: true, color: true, imei: true } },
        },
      })
      if (!nasiya) throw { status: 404, message: "Nasiya topilmadi" }
      if (nasiya.status === 'COMPLETED') throw { status: 409, message: 'Bu nasiya yakunlangan' }

      if (deferredToNext && idempotencyKey) {
        const existingDeferral = await tx.nasiyaDeferral.findUnique({
          where: { shopId_idempotencyKey: { shopId, idempotencyKey } },
        })
        if (existingDeferral) {
          if (existingDeferral.nasiyaId !== nasiyaId || existingDeferral.nasiyaScheduleId !== nasiyaScheduleId) {
            throw { status: 409, message: 'Idempotency-Key boshqa nasiya kechiktirish amali uchun ishlatilgan' }
          }
          return {
            nasiyaId,
            nasiyaScheduleId: existingDeferral.nasiyaScheduleId,
            amount: 0,
            remaining: Number(nasiya.remainingAmount),
            allocations: [],
            duplicate: true,
          }
        }
      }

      if (amountUzs > 0 && idempotencyKey) {
        const existingPayment = await tx.nasiyaPayment.findUnique({
          where: { shopId_idempotencyKey: { shopId, idempotencyKey } },
        })
        if (existingPayment) {
          if (existingPayment.nasiyaId !== nasiyaId) {
            throw { status: 409, message: "Idempotency-Key boshqa nasiya to'lovi uchun ishlatilgan" }
          }
          return {
            nasiyaId,
            nasiyaScheduleId: existingPayment.nasiyaScheduleId,
            amount: Number(existingPayment.amount),
            remaining: Number(nasiya.remainingAmount),
            duplicate: true,
          }
        }
      }

      const selectedSchedule = await tx.nasiyaSchedule.findFirst({
        where: { id: nasiyaScheduleId, nasiyaId, shopId },
      })
      if (!selectedSchedule) throw { status: 404, message: "To'lov jadvali topilmadi" }
      if (deferredToNext) {
        const currentDue = selectedSchedule.delayedUntil ?? selectedSchedule.dueDate
        if (!delayedUntil || delayedUntil <= currentDue) {
          throw { status: 400, message: "Yangi to'lov sanasi hozirgi muddatdan keyin bo'lishi kerak" }
        }
      }

      // Eligibility filter: a schedule already marked PAID is skipped as a
      // cheap short-circuit; every other schedule is still evaluated by the
      // pure allocator below, which decides completion from the CONTRACT
      // ledger, never the legacy one — see nasiya-payment-allocation.ts
      // (item 4 rate-drift fix).
      const unpaidSchedules = [...nasiya.schedules].filter((schedule) => schedule.status !== 'PAID')
      const selectedOutstanding = contractScheduleOutstanding(
        Number(selectedSchedule.contractExpectedAmount),
        Number(selectedSchedule.contractPaidAmount),
        contractCurrency,
      )
      const allocationRows = [
        ...unpaidSchedules.filter((schedule) => schedule.id === selectedSchedule.id),
        ...unpaidSchedules
          .filter((schedule) => schedule.id !== selectedSchedule.id)
          .sort((left, right) => {
          const leftDue = left.delayedUntil ?? left.dueDate
          const rightDue = right.delayedUntil ?? right.dueDate
          return leftDue.getTime() - rightDue.getTime() || left.monthNumber - right.monthNumber
        }),
      ]

      const allocations: { scheduleId: string; amount: number; paidAfter: number; monthNumber: number; contractAmount: number }[] = []

      if (deferredToNext) {
        const updatedSchedule = await tx.nasiyaSchedule.updateMany({
          where: {
            id: nasiyaScheduleId,
            nasiyaId,
            shopId,
            paidAmount: selectedSchedule.paidAmount,
          },
          data: {
            status: 'DEFERRED',
            delayedUntil,
            deferredToNext: true,
            note: auditNote,
          },
        })
        if (updatedSchedule.count !== 1) {
          throw { status: 409, message: "To'lov bir vaqtda yangilangan, qayta urinib ko'ring" }
        }
        await tx.nasiyaDeferral.create({
          data: {
            shopId,
            nasiyaId,
            nasiyaScheduleId,
            delayedUntil: delayedUntil!,
            note: auditNote,
            idempotencyKey: idempotencyKey!,
            createdBy: session.user.id,
          },
        })
      } else {
        if (selectedOutstanding <= 0) {
          throw { status: 409, message: "Tanlangan oy to'lovi allaqachon yopilgan" }
        }
        // Item 4 fix: compared in CONTRACT currency, not a legacy-UZS sum —
        // a legacy sum frozen at each schedule's creation rate can drift
        // from the real remaining contract debt after enough exchange-rate
        // movement, wrongly rejecting (or wrongly allowing) a payment. See
        // nasiya-payment-allocation.ts's totalContractOutstanding doc comment.
        const totalOutstandingContract = totalContractOutstanding(
          allocationRows.map((schedule) => ({
            contractExpectedAmount: Number(schedule.contractExpectedAmount),
            contractPaidAmount: Number(schedule.contractPaidAmount),
          })),
          contractCurrency,
        )
        if (appliedAmountInContractCurrency > totalOutstandingContract) {
          throw { status: 409, message: "To'lov qolgan nasiya summasidan oshib ketdi" }
        }

        const scheduleUpdates = allocateNasiyaPayment({
          schedules: allocationRows.map((schedule) => ({
            id: schedule.id,
            monthNumber: schedule.monthNumber,
            dueDate: schedule.dueDate,
            delayedUntil: schedule.delayedUntil,
            expectedAmount: Number(schedule.expectedAmount),
            paidAmount: Number(schedule.paidAmount),
            contractExpectedAmount: Number(schedule.contractExpectedAmount),
            contractPaidAmount: Number(schedule.contractPaidAmount),
          })),
          amountUzs,
          appliedAmountInContractCurrency,
          contractCurrency,
          now: date,
        })

        for (const scheduleUpdate of scheduleUpdates) {
          const original = allocationRows.find((s) => s.id === scheduleUpdate.scheduleId)!
          const updatedSchedule = await tx.nasiyaSchedule.updateMany({
            where: {
              id: scheduleUpdate.scheduleId,
              nasiyaId,
              shopId,
              paidAmount: original.paidAmount,
            },
            data: {
              paidAmount: scheduleUpdate.newPaidAmount,
              status: scheduleUpdate.status,
              paidAt: scheduleUpdate.markPaidAt ? date : null,
              paymentMethod: effectivePaymentMethod,
              note: auditNote,
              contractPaidAmount: scheduleUpdate.newContractPaidAmount,
              contractRemainingAmount: scheduleUpdate.newContractRemainingAmount,
            },
          })
          if (updatedSchedule.count !== 1) {
            throw { status: 409, message: "To'lov bir vaqtda yangilangan, qayta urinib ko'ring" }
          }

          allocations.push({
            scheduleId: scheduleUpdate.scheduleId,
            amount: scheduleUpdate.appliedUzs,
            paidAfter: scheduleUpdate.newPaidAmount,
            monthNumber: scheduleUpdate.monthNumber,
            contractAmount: scheduleUpdate.appliedContract,
          })
        }

        await tx.nasiyaPayment.create({
          data: {
            nasiyaId,
            nasiyaScheduleId: allocations.length === 1 ? allocations[0].scheduleId : null,
            shopId,
            amount: amountUzs,
            paymentMethod: effectivePaymentMethod,
            paymentBreakdown: paymentBreakdown ?? undefined,
            paidAt: date,
            note: auditNote,
            idempotencyKey,
            createdBy: session.user.id,
            // What the customer actually entered, preserved for historical
            // display — see docs/currency-accounting-model.md.
            paymentInputAmount: amount,
            paymentInputCurrency: amountInput.inputCurrency,
            appliedAmountInContractCurrency,
            paymentExchangeRate: amountInput.exchangeRateUsed,
          },
        })
      }

      // Recalculate nasiya totals
      const allSchedules = await tx.nasiyaSchedule.findMany({ where: { nasiyaId } })
      const scheduleInputs = allSchedules.map((s) => ({
        status: s.status,
        dueDate: s.dueDate,
        delayedUntil: s.delayedUntil,
        expectedAmount: Number(s.expectedAmount),
        paidAmount: Number(s.paidAmount),
      }))
      const totalPaid = allSchedules.reduce((sum: number, s: { paidAmount: unknown }) => sum + Number(s.paidAmount), 0)
      const remaining = calculateRemaining(Number(nasiya.finalNasiyaAmount), totalPaid)

      // Native contract-currency totals — the actual source of truth for
      // whether this nasiya is complete (see docs/currency-accounting-model.md).
      const contractTotalPaid = allSchedules.reduce((sum, s) => sum + Number(s.contractPaidAmount), 0)
      const contractRemaining = Math.max(0, Number(nasiya.contractFinalAmount) - contractTotalPaid)

      // Completion is decided from the contract ledger — currency-aware
      // tolerance (500 so'm / $0.01), never the legacy UZS remainder, so a
      // USD contract never gets stuck "Faol" over UZS-sized rounding dust
      // (or the reverse: closed early by a UZS tolerance too loose for cents).
      const contractAllFullyPaid =
        allSchedules.length > 0 &&
        allSchedules.every(
          (s) => contractScheduleOutstanding(Number(s.contractExpectedAmount), Number(s.contractPaidAmount), contractCurrency) <= 0,
        )
      // Overdue-ness is due-date-driven (schedule.status/dueDate), not an
      // amount comparison, so it stays on the existing currency-agnostic check.
      const hasOverdue = scheduleInputs.some((s) => isScheduleOverdue(s))

      const newStatus = contractAllFullyPaid || contractRemaining <= 0 ? 'COMPLETED' : hasOverdue ? 'OVERDUE' : 'ACTIVE'
      // Only true the instant a nasiya crosses into COMPLETED — the guard at
      // the top of this transaction already rejects a request against a
      // nasiya whose stored status is COMPLETED, so reaching this line always
      // means the nasiya started as ACTIVE/OVERDUE; this can never fire twice.
      const justCompleted = newStatus === 'COMPLETED'
      // Snap the stored remaining debt to exactly 0 once effectively complete
      // in contract-currency terms — clean bookkeeping instead of a lingering
      // rounding-dust remainder, kept in lockstep across both ledgers.
      const remainingToStore = contractAllFullyPaid ? 0 : remaining
      const contractRemainingToStore = contractAllFullyPaid ? 0 : contractRemaining

      await tx.nasiya.update({
        where: { id: nasiyaId },
        data: {
          remainingAmount: remainingToStore,
          status: newStatus,
          contractPaidAmount: contractTotalPaid,
          contractRemainingAmount: contractRemainingToStore,
        },
      })

      // Notify all active shop admins with a verified telegramId
      if (amountUzs > 0) {
        const shopAdmins = await tx.shopAdmin.findMany({
          where: { shopId, deletedAt: null, isActive: true, telegramId: { not: '' }, telegramVerifiedAt: { not: null } },
        })
        const paymentMessage = nasiyaPaymentMessage({
          shopName: nasiya.shop.name,
          customerName: nasiya.customer.name,
          customerPhone: nasiya.customer.phone,
          device: {
            deviceModel: nasiya.device.model,
            storage: nasiya.device.storage,
            color: nasiya.device.color,
            imei: nasiya.device.imei,
          },
          month: allocations.length === 1 ? selectedSchedule.monthNumber : 'MULTIPLE',
          paidAmount: appliedAmountInContractCurrency,
          contractCurrency,
          paymentMethod: effectivePaymentMethod,
          paymentBreakdown,
          remaining: contractRemainingToStore,
          note: auditNote,
          paymentInput: { amount, currency: amountInput.inputCurrency },
          adminName: session.user.name,
          currency,
          allocations: allocations.map((a) => ({ monthNumber: a.monthNumber, amount: a.contractAmount })),
        })
        const completedMessage = justCompleted
          ? nasiyaCompletedMessage({
              shopName: nasiya.shop.name,
              customerName: nasiya.customer.name,
              customerPhone: nasiya.customer.phone,
              device: {
                deviceModel: nasiya.device.model,
                storage: nasiya.device.storage,
                color: nasiya.device.color,
                imei: nasiya.device.imei,
              },
              finalNasiyaAmount: Number(nasiya.contractFinalAmount),
              contractCurrency,
              adminName: session.user.name,
              currency,
            })
          : null
        for (const admin of shopAdmins) {
          await tx.notification.create({
            data: {
              shopId,
              type: 'PAYMENT_RECEIVED',
              message: paymentMessage,
              telegramId: admin.telegramId!,
              scheduledAt: new Date(),
              relatedId: allocations.length === 1 ? allocations[0].scheduleId : nasiyaId,
              relatedType: allocations.length === 1 ? 'NasiyaSchedule' : 'Nasiya',
            },
          })
          if (completedMessage) {
            await tx.notification.create({
              data: {
                shopId,
                type: 'NASIYA_COMPLETED',
                message: completedMessage,
                telegramId: admin.telegramId!,
                scheduledAt: new Date(),
                relatedId: nasiyaId,
                relatedType: 'Nasiya',
              },
            })
          }
        }
      }

      await tx.log.create({
        data: {
          shopId,
          actorId: session.user.id,
          actorType: session.user.role as 'SUPER_ADMIN' | 'SHOP_ADMIN',
          // Deferring a schedule ("Mijoz bu oy to'lamadi, muddatni uzaytirish")
          // is not a payment — a distinct action keeps Amallar tarixi from
          // mislabeling it as "To'lov qabul qilindi".
          action: deferredToNext ? 'NASIYA_DEFER' : 'PAYMENT',
          targetType: 'NasiyaSchedule',
          targetId: nasiyaScheduleId,
          newValue: deferredToNext
            ? {
                oldDueDate: (selectedSchedule.delayedUntil ?? selectedSchedule.dueDate).toISOString(),
                newDueDate: delayedUntil!.toISOString(),
                auditReason: auditNote,
              }
            : {
                amount: amountUzs,
                inputAmount: amount,
                paymentMethod: effectivePaymentMethod,
                paymentBreakdown,
                deferredToNext,
                allocations,
                auditReason: auditNote,
                contractCurrency,
                appliedAmountInContractCurrency,
                ...moneyInputMeta(amountInput),
              },
          note: auditNote,
        },
      })

      if (justCompleted) {
        await tx.log.create({
          data: {
            shopId,
            actorId: session.user.id,
            actorType: session.user.role as 'SUPER_ADMIN' | 'SHOP_ADMIN',
            action: 'NASIYA_COMPLETED',
            targetType: 'Nasiya',
            targetId: nasiyaId,
            newValue: { finalNasiyaAmount: Number(nasiya.finalNasiyaAmount) },
            note: 'Nasiya yakunlandi',
          },
        })
      }

      return { nasiyaId, nasiyaScheduleId, amount: amountUzs, remaining: remainingToStore, allocations, duplicate: false }
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

    return ok(result, result.duplicate ? "To'lov allaqachon qabul qilingan" : "To'lov muvaffaqiyatli qabul qilindi")
  } catch (err: unknown) {
    if (typeof err === 'object' && err !== null && 'status' in err) {
      const e = err as { status: number; message: string }
      if (e.status === 400) return badRequest(e.message)
      if (e.status === 404) return notFound(e.message)
      if (e.status === 409) return conflict(e.message)
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return conflict("Idempotency-Key bo'yicha to'lov allaqachon yozilgan")
    }
    logger.error('[POST /api/nasiya/[id]/payment]', { event: 'api.route_error', error: err })
    return serverError()
  }
}
