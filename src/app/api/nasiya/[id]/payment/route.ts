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
import { requireShopPermissionAndFeature, resolveActiveShopId } from '@/lib/api-auth'
import { addNasiyaPaymentSchema } from '@/lib/validations'
import { calculateRemaining } from '@/lib/nasiya-utils'
import { convertPaymentToContractCurrency, contractScheduleOutstanding, isContractCurrencyDust } from '@/lib/nasiya-contract'
import { deriveContractNasiyaStatus } from '@/lib/nasiya-contract-status'
import { allocateNasiyaPayment, totalContractOutstanding } from '@/lib/nasiya-payment-allocation'
import { ok, badRequest, notFound, conflict, serverError, tooManyRequests } from '@/lib/api-helpers'
import { processPendingNotifications } from '@/lib/notification-service'
import { nasiyaPaymentMessage, nasiyaCompletedMessage } from '@/lib/telegram-templates'
import { logger } from '@/lib/logger'
import { isRetryableTransactionError } from '@/lib/server/transaction-retry'
import { rateLimitKey } from '@/lib/rate-limit'
import { checkRateLimitDistributed } from '@/lib/rate-limit-adapter'
import { invalidateShopPaymentMutation } from '@/lib/server/cache-tags'
import { moneyInputToUzs, moneyInputMeta } from '@/lib/server/money-input'
import { getShopCurrencyContext, getUsdUzsRate } from '@/lib/server/currency'
import { validatePaymentBreakdown, representativePaymentMethod } from '@/lib/payment-breakdown'
import type { ZodError } from 'zod'
import { presentDeviceSpecs } from '@/lib/device-specs'
import { canonicalPaymentBreakdown, sameInstant, sameMoney, sameOptionalText } from '@/lib/idempotency-replay'
import {
  allocateCumulativePaymentComponents,
  allocateUzsAcrossContractAmounts,
  splitUzsReportingAmount,
} from '@/lib/payment-profit-allocation'

type RouteContext = { params: Promise<{ id: string }> }

type ExistingPaymentForReplay = {
  nasiyaId: string
  nasiyaScheduleId: string | null
  amount: unknown
  paymentMethod: string | null
  paymentBreakdown: unknown
  paidAt: Date
  note: string | null
  paymentInputAmount: unknown | null
  paymentInputCurrency: 'UZS' | 'USD' | null
}

/**
 * An idempotency key identifies the complete durable payment command, not just
 * the target contract. Replaying the same command is safe; changing any field
 * that was persisted with the payment is a conflict.
 *
 * Older multi-schedule rows stored a null nasiyaScheduleId, so that one field
 * cannot be proven for those legacy rows. New rows always store the originally
 * selected schedule below, making future comparisons complete.
 */
function matchesExistingPaymentPayload(
  existing: ExistingPaymentForReplay,
  submitted: {
    nasiyaId: string
    nasiyaScheduleId: string
    amount: number
    inputCurrency: 'UZS' | 'USD'
    paymentMethod: string | undefined
    paymentBreakdown: unknown
    paidAt: Date
    note: string | undefined
  },
): boolean {
  if (existing.nasiyaId !== submitted.nasiyaId) return false
  if (existing.nasiyaScheduleId !== null && existing.nasiyaScheduleId !== submitted.nasiyaScheduleId) return false

  const storedCurrency = existing.paymentInputCurrency ?? 'UZS'
  if (storedCurrency !== submitted.inputCurrency) return false
  const storedInputAmount = Number(existing.paymentInputAmount ?? existing.amount)
  if (!sameMoney(storedInputAmount, submitted.amount, storedCurrency)) return false
  if (existing.paymentMethod !== (submitted.paymentMethod ?? null)) return false
  if (
    canonicalPaymentBreakdown(existing.paymentBreakdown, storedCurrency) !==
    canonicalPaymentBreakdown(submitted.paymentBreakdown, submitted.inputCurrency)
  ) {
    return false
  }
  if (!sameInstant(existing.paidAt, submitted.paidAt)) return false
  return sameOptionalText(existing.note, submitted.note)
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const guarded = await requireShopPermissionAndFeature('NASIYA_PAYMENT_RECEIVE', 'NASIYA')
    if (!guarded.ok) return guarded.response
    const { session } = guarded

    const { id: nasiyaId } = await ctx.params
    const body: unknown = await req.json()
    const parsed = addNasiyaPaymentSchema.safeParse(body)

    if (!parsed.success) {
      const firstError = (parsed.error as ZodError).issues[0]?.message ?? "Noto'g'ri ma'lumot"
      return badRequest(firstError)
    }

    const { nasiyaScheduleId, amount, paymentMethod, paymentBreakdown, date, note } = parsed.data
    const idempotencyKey = req.headers.get('idempotency-key')?.trim()
    if (!idempotencyKey) {
      return badRequest('Idempotency-Key sarlavhasi kiritilishi shart')
    }

    // Item 12 — split payment (e.g. half cash, half card). Parts must sum
    // to the payment amount; the existing paymentMethod field stays
    // populated with a representative value so no existing reader breaks.
    if (paymentBreakdown) {
      const breakdownError = validatePaymentBreakdown(paymentBreakdown, amount, parsed.data.inputCurrency ?? 'UZS')
      if (breakdownError) return badRequest(breakdownError)
    }
    const effectivePaymentMethod = paymentBreakdown ? representativePaymentMethod(paymentBreakdown) : paymentMethod

    const resolved = await resolveActiveShopId(session, (body as { shopId?: string }).shopId)
    if (!resolved.ok) return resolved.response
    const { shopId } = resolved

    // Distributed when Upstash is configured; bounded in-process fallback otherwise.
    const rate = await checkRateLimitDistributed(rateLimitKey('nasiya-payment', shopId, session.user.id), { windowMs: 60_000, max: 20 })
    if (!rate.allowed) return tooManyRequests(rate.retryAfterSeconds)

    const currency = await getShopCurrencyContext(shopId)
    // A regular payment note is optional. Store blank input as NULL, never as
    // a fabricated placeholder or an empty string.
    const auditNote = note?.trim() || undefined
    let amountInput: Awaited<ReturnType<typeof moneyInputToUzs>>
    try {
      amountInput = await moneyInputToUzs(amount, parsed.data.inputCurrency)
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
    const contractLookup = await prisma.nasiya.findFirst({
      where: { id: nasiyaId, shopId, resolutionState: 'ACTIVE' },
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
    const appliedAmountInContractCurrency = convertPaymentToContractCurrency(
      amount,
      amountInput.inputCurrency,
      contractCurrency,
      contractRate,
    )

    const runPaymentTransaction = () =>
      prisma.$transaction(
        async (tx: Prisma.TransactionClient) => {
          // Verify nasiya exists and belongs to this shop
          const nasiya = await tx.nasiya.findFirst({
            where: {
              id: nasiyaId,
              shopId,
              deletedAt: null,
              status: { not: 'CANCELLED' },
              resolutionState: 'ACTIVE',
            },
            include: {
              schedules: true,
              shop: { select: { name: true } },
              customer: { select: { name: true, phone: true } },
              device: {
                include: { imeis: { where: { deletedAt: null } } },
              },
            },
          })
          if (!nasiya) throw { status: 404, message: 'Nasiya topilmadi' }

          if (idempotencyKey) {
            const existingPayment = await tx.nasiyaPayment.findUnique({
              where: { shopId_idempotencyKey: { shopId, idempotencyKey } },
            })
            if (existingPayment) {
              if (
                !matchesExistingPaymentPayload(existingPayment, {
                  nasiyaId,
                  nasiyaScheduleId,
                  amount,
                  inputCurrency: amountInput.inputCurrency,
                  paymentMethod: effectivePaymentMethod,
                  paymentBreakdown,
                  paidAt: date,
                  note: auditNote,
                })
              ) {
                throw {
                  status: 409,
                  message: "Idempotency-Key boshqa yoki o'zgartirilgan nasiya to'lovi uchun ishlatilgan",
                }
              }
              return {
                nasiyaId,
                nasiyaScheduleId: existingPayment.nasiyaScheduleId ?? nasiyaScheduleId,
                amount: Number(existingPayment.amount),
                remaining: Number(nasiya.remainingAmount),
                duplicate: true,
              }
            }
          }

          const currentContractStatus = deriveContractNasiyaStatus({
            status: nasiya.status,
            contractCurrency: nasiya.contractCurrency,
            contractFinalAmount: Number(nasiya.contractFinalAmount),
            contractRemainingAmount: Number(nasiya.contractRemainingAmount),
            schedules: nasiya.schedules.map((schedule) => ({
              status: schedule.status,
              dueDate: schedule.dueDate,
              delayedUntil: schedule.delayedUntil,
              expectedAmount: Number(schedule.expectedAmount),
              paidAmount: Number(schedule.paidAmount),
              contractExpectedAmount: Number(schedule.contractExpectedAmount),
              contractPaidAmount: Number(schedule.contractPaidAmount),
            })),
          })
          // Idempotent replays above must be returned before this terminal-state
          // guard; otherwise retrying the final successful payment reports 409.
          // A raw COMPLETED parent can also be stale after legacy-UZS/contract
          // FX drift, so reject only a contract-complete nasiya.
          if (currentContractStatus.displayStatus === 'COMPLETED') throw { status: 409, message: 'Bu nasiya yakunlangan' }

          const selectedSchedule = await tx.nasiyaSchedule.findFirst({
            where: { id: nasiyaScheduleId, nasiyaId, shopId },
          })
          if (!selectedSchedule) throw { status: 404, message: "To'lov jadvali topilmadi" }

          // Eligibility is contract-ledger-based, not a stored schedule label:
          // a legacy-derived PAID label must not prevent settling native debt.
          const unpaidSchedules = [...nasiya.schedules].filter(
            (schedule) =>
              contractScheduleOutstanding(
                Number(schedule.contractExpectedAmount),
                Number(schedule.contractPaidAmount),
                contractCurrency,
              ) > 0,
          )
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

          const allocations: {
            scheduleId: string
            amount: number
            paidAfter: number
            monthNumber: number
            contractAmount: number
          }[] = []

          if (selectedOutstanding <= 0) {
            throw {
              status: 409,
              message: "Tanlangan oy to'lovi allaqachon yopilgan",
            }
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
            if (
              appliedAmountInContractCurrency > totalOutstandingContract &&
              !isContractCurrencyDust(appliedAmountInContractCurrency - totalOutstandingContract, contractCurrency)
            ) {
              throw {
                status: 409,
                message: "To'lov qolgan nasiya summasidan oshib ketdi",
              }
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
            const allocationUzsAmounts = allocateUzsAcrossContractAmounts(
              amountUzs,
              scheduleUpdates.map((update) => update.appliedContract),
            )
            const profitAllocations: {
              scheduleId: string
              contractAmount: number
              amountUzs: number
              components: { principal: number; margin: number; interest: number }
              reporting: { principal: number; margin: number; interest: number }
            }[] = []

            for (const [allocationIndex, scheduleUpdate] of scheduleUpdates.entries()) {
              const original = allocationRows.find((s) => s.id === scheduleUpdate.scheduleId)!
              const componentResult = ['COMPLETE', 'PARTIAL'].includes(nasiya.accountingReconstructionStatus)
                ? allocateCumulativePaymentComponents({
                    currency: contractCurrency,
                    totals: {
                      principal: Number(original.contractPrincipalAmount),
                      margin: Number(original.contractMarginAmount),
                      interest: Number(original.contractInterestAmount),
                    },
                    paid: {
                      principal: Number(original.contractPrincipalPaidAmount),
                      margin: Number(original.contractMarginPaidAmount),
                      interest: Number(original.contractInterestPaidAmount),
                    },
                    paymentAmount: scheduleUpdate.appliedContract,
                  })
                : null
              const allocationUzs = allocationUzsAmounts[allocationIndex]
              const reportingComponents = componentResult
                ? splitUzsReportingAmount({
                    amountUzs: allocationUzs,
                    contractAmount: scheduleUpdate.appliedContract,
                    contractComponents: componentResult.allocation,
                  })
                : null
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
                  ...(componentResult ? {
                    contractPrincipalPaidAmount: componentResult.paidAfter.principal,
                    contractMarginPaidAmount: componentResult.paidAfter.margin,
                    contractInterestPaidAmount: componentResult.paidAfter.interest,
                  } : {}),
                },
              })
              if (updatedSchedule.count !== 1) {
                throw {
                  status: 409,
                  message: "To'lov bir vaqtda yangilangan, qayta urinib ko'ring",
                }
              }

              allocations.push({
                scheduleId: scheduleUpdate.scheduleId,
                amount: scheduleUpdate.appliedUzs,
                paidAfter: scheduleUpdate.newPaidAmount,
                monthNumber: scheduleUpdate.monthNumber,
                contractAmount: scheduleUpdate.appliedContract,
              })
              if (componentResult && reportingComponents) {
                profitAllocations.push({
                  scheduleId: scheduleUpdate.scheduleId,
                  contractAmount: scheduleUpdate.appliedContract,
                  amountUzs: allocationUzs,
                  components: componentResult.allocation,
                  reporting: reportingComponents,
                })
              }
            }

            const payment = await tx.nasiyaPayment.create({
              data: {
                nasiyaId,
                // Preserve the user's selected schedule even when the amount
                // overflows into later schedules. It is part of the durable
                // idempotency command and is useful audit context.
                nasiyaScheduleId,
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
                paymentExchangeRate: contractRate,
              },
            })
            if (profitAllocations.length > 0) {
              await tx.nasiyaPaymentAllocation.createMany({
                data: profitAllocations.map((allocation, index) => ({
                  shopId,
                  nasiyaId,
                  nasiyaPaymentId: payment.id,
                  nasiyaScheduleId: allocation.scheduleId,
                  sequence: index + 1,
                  contractCurrency,
                  contractAmount: allocation.contractAmount,
                  contractPrincipalAmount: allocation.components.principal,
                  contractMarginAmount: allocation.components.margin,
                  contractInterestAmount: allocation.components.interest,
                  amountUzs: allocation.amountUzs,
                  principalAmountUzs: allocation.reporting.principal,
                  marginAmountUzs: allocation.reporting.margin,
                  interestAmountUzs: allocation.reporting.interest,
                })),
              })
            }
          // Recalculate nasiya totals
          const allSchedules = await tx.nasiyaSchedule.findMany({
            where: { nasiyaId },
          })
          const scheduleInputs = allSchedules.map((s) => ({
            status: s.status,
            dueDate: s.dueDate,
            delayedUntil: s.delayedUntil,
            expectedAmount: Number(s.expectedAmount),
            paidAmount: Number(s.paidAmount),
            contractExpectedAmount: Number(s.contractExpectedAmount),
            contractPaidAmount: Number(s.contractPaidAmount),
          }))
          const totalPaid = allSchedules.reduce((sum: number, s: { paidAmount: unknown }) => sum + Number(s.paidAmount), 0)
          const remaining = calculateRemaining(Number(nasiya.finalNasiyaAmount), totalPaid)

          // Native contract-currency totals — the actual source of truth for
          // whether this nasiya is complete (see docs/currency-accounting-model.md).
          const contractTotalPaid = allSchedules.reduce((sum, s) => sum + Number(s.contractPaidAmount), 0)
          const contractRemaining = Math.max(0, Number(nasiya.contractFinalAmount) - contractTotalPaid)

          const derivedAfterPayment = deriveContractNasiyaStatus({
            status: nasiya.status,
            contractCurrency,
            contractFinalAmount: Number(nasiya.contractFinalAmount),
            contractRemainingAmount: contractRemaining,
            schedules: scheduleInputs,
          })
          const newStatus = derivedAfterPayment.displayStatus
          // The contract-complete guard above excludes an already-complete
          // contract, so reaching COMPLETED here is a real transition.
          const justCompleted = newStatus === 'COMPLETED'
          // The legacy UZS fields stay compatibility snapshots. Both parent
          // status and contract remainder above are decided only by native
          // contract schedule amounts, so an FX-rate move cannot close debt.
          const remainingToStore = newStatus === 'COMPLETED' ? 0 : remaining
          const contractRemainingToStore = newStatus === 'COMPLETED' ? 0 : contractRemaining

          await tx.nasiya.update({
            where: { id: nasiyaId },
            data: {
              remainingAmount: remainingToStore,
              status: newStatus,
              contractPaidAmount: contractTotalPaid,
              contractRemainingAmount: contractRemainingToStore,
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
          const paymentMessage = nasiyaPaymentMessage({
              shopName: nasiya.shop.name,
              customerName: nasiya.customer.name,
              customerPhone: nasiya.customer.phone,
              device: presentDeviceSpecs(nasiya.device),
              month: allocations.length === 1 ? selectedSchedule.monthNumber : 'MULTIPLE',
              paidAmount: appliedAmountInContractCurrency,
              contractCurrency,
              paymentMethod: effectivePaymentMethod,
              paymentBreakdown,
              remaining: contractRemainingToStore,
              note: auditNote,
              paymentInput: { amount, currency: amountInput.inputCurrency },
              paymentExchangeRate: contractRate,
              adminName: session.user.name,
              currency,
              allocations: allocations.map((a) => ({
                monthNumber: a.monthNumber,
                amount: a.contractAmount,
              })),
            })
          const completedMessage = justCompleted
              ? nasiyaCompletedMessage({
                  shopName: nasiya.shop.name,
                  customerName: nasiya.customer.name,
                  customerPhone: nasiya.customer.phone,
                  device: presentDeviceSpecs(nasiya.device),
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
                  recipientShopAdminId: admin.id,
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
                    recipientShopAdminId: admin.id,
                    scheduledAt: new Date(),
                    relatedId: nasiyaId,
                    relatedType: 'Nasiya',
                  },
                })
            }
          }

          await tx.log.create({
            data: {
              shopId,
              actorId: session.user.id,
              actorType: session.user.role as 'SUPER_ADMIN' | 'SHOP_ADMIN',
              action: 'PAYMENT',
              targetType: 'NasiyaSchedule',
              targetId: nasiyaScheduleId,
              newValue: {
                amount: amountUzs,
                inputAmount: amount,
                paymentMethod: effectivePaymentMethod,
                paymentBreakdown,
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
                newValue: {
                  finalNasiyaAmount: Number(nasiya.finalNasiyaAmount),
                },
                note: 'Nasiya yakunlandi',
              },
            })
          }

          return {
            nasiyaId,
            nasiyaScheduleId,
            amount: amountUzs,
            remaining: remainingToStore,
            allocations,
            duplicate: false,
          }
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
    logger.error('[POST /api/nasiya/[id]/payment]', {
      event: 'api.route_error',
      error: err,
    })
    return serverError()
  }
}
