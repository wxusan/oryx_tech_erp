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
import { calculateRemaining, scheduleOutstanding, isScheduleOverdue } from '@/lib/nasiya-utils'
import { convertPaymentToContractCurrency, contractScheduleOutstanding } from '@/lib/nasiya-contract'
import { ok, badRequest, notFound, conflict, serverError } from '@/lib/api-helpers'
import { processPendingNotifications } from '@/lib/notification-service'
import { nasiyaPaymentMessage, nasiyaCompletedMessage } from '@/lib/telegram-templates'
import { logger } from '@/lib/logger'
import { invalidateShopPaymentMutation } from '@/lib/server/cache-tags'
import { moneyInputToUzs, moneyInputMeta } from '@/lib/server/money-input'
import { getShopCurrencyContext, getUsdUzsRate } from '@/lib/server/currency'
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
      date,
      delayedUntil,
      note,
      deferredToNext,
    } = parsed.data
    const idempotencyKey = req.headers.get('idempotency-key')?.trim()
    if ((amount > 0 || deferredToNext) && !idempotencyKey) {
      return badRequest('Idempotency-Key sarlavhasi kiritilishi shart')
    }

    const resolved = await resolveActiveShopId(session, (body as { shopId?: string }).shopId)
    if (!resolved.ok) return resolved.response
    const { shopId } = resolved
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

      const unpaidSchedules = [...nasiya.schedules]
        .filter((schedule) => {
          if (schedule.status === 'PAID') return false
          return scheduleOutstanding(Number(schedule.expectedAmount), Number(schedule.paidAmount)) > 0
        })
      const selectedOutstanding = scheduleOutstanding(
        Number(selectedSchedule.expectedAmount),
        Number(selectedSchedule.paidAmount),
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
        const totalOutstanding = allocationRows.reduce(
          (sum, schedule) => sum + scheduleOutstanding(Number(schedule.expectedAmount), Number(schedule.paidAmount)),
          0,
        )
        if (amountUzs > totalOutstanding) {
          throw { status: 409, message: "To'lov qolgan nasiya summasidan oshib ketdi" }
        }

        let remainingPayment = amountUzs
        let remainingContractPayment = appliedAmountInContractCurrency
        for (const schedule of allocationRows) {
          if (remainingPayment <= 0 && remainingContractPayment <= 0) break
          const outstanding = scheduleOutstanding(Number(schedule.expectedAmount), Number(schedule.paidAmount))
          const applied = Math.min(remainingPayment, outstanding)
          const newPaidAmountRaw = Number(schedule.paidAmount) + applied
          const isFullyPaid = scheduleOutstanding(Number(schedule.expectedAmount), newPaidAmountRaw) <= 0
          // Within the rounding tolerance, snap the stored paidAmount up to the
          // exact expectedAmount so the ledger never dangles a few hundred so'm
          // short forever — see COMPLETION_ROUNDING_TOLERANCE_UZS.
          const newPaidAmount = isFullyPaid ? Number(schedule.expectedAmount) : newPaidAmountRaw
          const isPartial = !isFullyPaid && newPaidAmount > 0
          const effectiveDueDate = schedule.delayedUntil ?? schedule.dueDate
          const isPastDue = effectiveDueDate < new Date()
          const nextStatus = isFullyPaid ? 'PAID' : isPastDue ? 'OVERDUE' : isPartial ? 'PARTIAL' : 'PENDING'

          // Native contract-currency mirror of the same allocation — see
          // docs/currency-accounting-model.md. Proportional to the legacy
          // allocation above (same payment, same schedule), just denominated
          // in contractCurrency and tolerance-checked in that currency.
          const contractOutstanding = contractScheduleOutstanding(
            Number(schedule.contractExpectedAmount),
            Number(schedule.contractPaidAmount),
            contractCurrency,
          )
          const contractApplied = Math.min(remainingContractPayment, contractOutstanding)
          const newContractPaidAmountRaw = Number(schedule.contractPaidAmount) + contractApplied
          const isContractFullyPaid =
            contractScheduleOutstanding(Number(schedule.contractExpectedAmount), newContractPaidAmountRaw, contractCurrency) <= 0
          const newContractPaidAmount = isContractFullyPaid ? Number(schedule.contractExpectedAmount) : newContractPaidAmountRaw
          const newContractRemainingAmount = Math.max(0, Number(schedule.contractExpectedAmount) - newContractPaidAmount)

          const updatedSchedule = await tx.nasiyaSchedule.updateMany({
            where: {
              id: schedule.id,
              nasiyaId,
              shopId,
              paidAmount: schedule.paidAmount,
            },
            data: {
              paidAmount: newPaidAmount,
              status: nextStatus,
              paidAt: isFullyPaid ? date : null,
              paymentMethod,
              note: auditNote,
              contractPaidAmount: newContractPaidAmount,
              contractRemainingAmount: newContractRemainingAmount,
            },
          })
          if (updatedSchedule.count !== 1) {
            throw { status: 409, message: "To'lov bir vaqtda yangilangan, qayta urinib ko'ring" }
          }

          allocations.push({
            scheduleId: schedule.id,
            amount: applied,
            paidAfter: newPaidAmount,
            monthNumber: schedule.monthNumber,
            contractAmount: contractApplied,
          })
          remainingPayment -= applied
          remainingContractPayment -= contractApplied
        }

        await tx.nasiyaPayment.create({
          data: {
            nasiyaId,
            nasiyaScheduleId: allocations.length === 1 ? allocations[0].scheduleId : null,
            shopId,
            amount: amountUzs,
            paymentMethod,
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
          paymentMethod,
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
                paymentMethod,
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
    console.error('[POST /api/nasiya/[id]/payment]', err)
    return serverError()
  }
}
