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
import { allocateNasiyaPayment } from '@/lib/nasiya-payment-allocation'
import { ok, badRequest, notFound, conflict, serverError, tooManyRequests } from '@/lib/api-helpers'
import { flushQueuedTelegramWork } from '@/lib/notification-service'
import { nasiyaPaymentMessage, nasiyaCompletedMessage } from '@/lib/telegram-templates'
import { logger } from '@/lib/logger'
import { isRetryableTransactionError } from '@/lib/server/transaction-retry'
import { rateLimitKey } from '@/lib/rate-limit'
import { checkRateLimitDistributed } from '@/lib/rate-limit-adapter'
import { invalidateShopPaymentMutation } from '@/lib/server/cache-tags'
import { getShopCurrencyContext, getUsdUzsRateSnapshot } from '@/lib/server/currency'
import { validatePaymentBreakdown, representativePaymentMethod } from '@/lib/payment-breakdown'
import type { ZodError } from 'zod'
import { presentDeviceSpecs } from '@/lib/device-specs'
import { canonicalPaymentBreakdown, sameInstant, sameMoney, sameOptionalText } from '@/lib/idempotency-replay'
import {
  allocateCumulativePaymentComponents,
  allocateUzsAcrossContractAmounts,
  splitUzsReportingAmount,
} from '@/lib/payment-profit-allocation'
import { convertMoneyDto, createFxQuoteDto, createMoneyDto, moneyDtoToAmount, type CurrencyCode } from '@/lib/currency'
import { moneyDtoDatabaseAmount, reconcileNasiyaLedger } from '@/lib/nasiya-ledger'
import {
  hasNasiyaPaymentFxQuoteColumns,
  nasiyaPaymentFxSourceForPersistence,
} from '@/lib/server/nasiya-payment-schema'
import { resolveTelegramRecipients, telegramNotificationRows, telegramUnavailableMarkerRows, TELEGRAM_AUDIENCES } from '@/lib/server/telegram-recipients'

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
  appliedAmountInContractCurrency: unknown | null
  paymentExchangeRate: unknown | null
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
  const startedAt = performance.now()
  const timings: Record<string, number> = {}
  let measuredShopId: string | null = null
  try {
    const authStartedAt = performance.now()
    const guarded = await requireShopPermissionAndFeature('NASIYA_PAYMENT_RECEIVE', 'NASIYA')
    timings.authenticationPermissions = performance.now() - authStartedAt
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
    measuredShopId = shopId
    const rateLimitStartedAt = performance.now()
    const rate = await checkRateLimitDistributed(rateLimitKey('nasiya-payment', shopId, session.user.id), { windowMs: 60_000, max: 20 })
    timings.rateLimiter = performance.now() - rateLimitStartedAt
    if (!rate.allowed) return tooManyRequests(rate.retryAfterSeconds)

    // These reads are independent and sit before the serializable write, so
    // do them concurrently instead of extending the login-to-payment path
    // with a needless three-query waterfall.
    const initialReadsStartedAt = performance.now()
    const [currency, paymentFxQuoteColumnsAvailable, contractLookup] = await Promise.all([
      getShopCurrencyContext(shopId),
      hasNasiyaPaymentFxQuoteColumns(),
      prisma.nasiya.findFirst({
        where: { id: nasiyaId, shopId, resolutionState: 'ACTIVE' },
        select: { contractCurrency: true, contractExchangeRateAtCreation: true },
      }),
    ])
    timings.initialDatabaseReads = performance.now() - initialReadsStartedAt
    // A regular payment note is optional. Store blank input as NULL, never as
    // a fabricated placeholder or an empty string.
    const auditNote = note?.trim() || undefined
    const inputCurrency = (parsed.data.inputCurrency ?? 'UZS') as CurrencyCode
    let inputMoney
    try {
      inputMoney = createMoneyDto(inputCurrency, amount)
    } catch (err) {
      return badRequest(err instanceof Error ? err.message : "To'lov summasi noto'g'ri")
    }

    // Contract and conversion lookup happen before the serializable mutation.
    // A rate is mandatory only when currencies genuinely differ. For a
    // same-currency USD payment, debt math remains available even if today's
    // quote endpoint is down; the legacy UZS reporting mirror then falls back
    // to the contract's frozen creation quote and is labelled as such by the
    // absence of a payment-time exchange rate on the receipt.
    let contractCurrency: 'UZS' | 'USD' = 'UZS'
    contractCurrency = contractLookup?.contractCurrency ?? 'UZS'
    const currencyFxStartedAt = performance.now()
    let paymentTimeSnapshot: Awaited<ReturnType<typeof getUsdUzsRateSnapshot>> | null = null
    if (inputCurrency !== contractCurrency) {
      try {
        paymentTimeSnapshot = await getUsdUzsRateSnapshot()
      } catch (err) {
        return badRequest(err instanceof Error ? err.message : 'Valyuta kursi mavjud emas')
      }
    }
    // A same-currency USD payment does not need a quote to settle USD debt.
    // Fetching one remains best-effort only to retain the old UZS report
    // snapshot; never block the operation when it is unavailable.
    if (inputCurrency === 'USD' && contractCurrency === 'USD') {
      try {
        paymentTimeSnapshot = await getUsdUzsRateSnapshot()
      } catch {
        if (!paymentFxQuoteColumnsAvailable) {
          return badRequest("USDdan USDga to'lov kurs talab qilmaydi, lekin bu ma'lumotlar bazasiga avval nasiya ledger yangilanishini qo'llash kerak")
        }
        paymentTimeSnapshot = null
      }
    }
    const paymentTimeRate = paymentTimeSnapshot?.rate ?? null
    const paymentTimeRateSource = nasiyaPaymentFxSourceForPersistence(paymentTimeSnapshot?.source)
    const conversionQuote = paymentTimeSnapshot == null
      ? null
      : createFxQuoteDto({
          rate: paymentTimeSnapshot.rate,
          source: paymentTimeSnapshot.source,
          effectiveAt: paymentTimeSnapshot.effectiveAt?.toISOString() ?? null,
          fetchedAt: paymentTimeSnapshot.fetchedAt.toISOString(),
          freshness: paymentTimeSnapshot.freshness,
        })
    const appliedMoney = convertMoneyDto(inputMoney, contractCurrency, conversionQuote)
    if (!appliedMoney) return badRequest("Turli valyutadagi to'lov uchun USD kursi mavjud emas")
    const appliedAmountInContractCurrency = moneyDtoToAmount(appliedMoney)
    const legacyUzsQuote = inputCurrency === 'USD' && !paymentTimeRate
      ? (contractLookup?.contractExchangeRateAtCreation == null
          ? null
          : createFxQuoteDto({
              rate: contractLookup.contractExchangeRateAtCreation.toString(),
              source: 'CONTRACT_CREATION_FALLBACK',
              freshness: 'FALLBACK',
            }))
      : conversionQuote
    const amountUzsMoney = convertMoneyDto(inputMoney, 'UZS', legacyUzsQuote)
    if (!amountUzsMoney) return badRequest("USD nasiya uchun muzlatilgan kurs mavjud emas")
    const amountUzs = moneyDtoToAmount(amountUzsMoney)
    const amountInput = {
      amountUzs,
      inputCurrency,
      // This is null only when a same-currency USD payment used a frozen
      // legacy reporting fallback. Do not falsely label it payment-time FX.
      exchangeRateUsed: paymentTimeRate,
    }
    timings.currencyFx = performance.now() - currencyFxStartedAt

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
              paymentAllocations: {
                select: {
                  nasiyaScheduleId: true,
                  contractCurrency: true,
                  contractAmount: true,
                },
              },
              shop: { select: { name: true } },
              customer: { select: { name: true, phone: true } },
              device: {
                include: { imeis: { where: { deletedAt: null } } },
              },
            },
          })
          if (!nasiya) throw { status: 404, message: 'Nasiya topilmadi' }

          // Derive the receipt response and all later validation from the
          // authoritative schedules. This is intentionally calculated before
          // the idempotency replay branch, but a matching replay still wins
          // over quarantine/completion guards below.
          const currentLedger = reconcileNasiyaLedger({
            status: nasiya.status,
            contractCurrency: nasiya.contractCurrency,
            contractFinalAmount: nasiya.contractFinalAmount.toString(),
            contractPaidAmount: nasiya.contractPaidAmount.toString(),
            contractRemainingAmount: nasiya.contractRemainingAmount.toString(),
            schedules: nasiya.schedules.map((schedule) => ({
              id: schedule.id,
              status: schedule.status,
              dueDate: schedule.dueDate,
              delayedUntil: schedule.delayedUntil,
              expectedAmount: schedule.expectedAmount.toString(),
              paidAmount: schedule.paidAmount.toString(),
              contractCurrency: schedule.contractCurrency,
              contractExpectedAmount: schedule.contractExpectedAmount.toString(),
              contractPaidAmount: schedule.contractPaidAmount.toString(),
              contractRemainingAmount: schedule.contractRemainingAmount.toString(),
            })),
            allocationHistoryComplete: nasiya.accountingReconstructionStatus === 'COMPLETE',
            allocations: nasiya.paymentAllocations.map((allocation) => ({
              nasiyaScheduleId: allocation.nasiyaScheduleId,
              contractCurrency: allocation.contractCurrency,
              contractAmount: allocation.contractAmount.toString(),
            })),
          })

          if (idempotencyKey) {
            const existingPayment = await tx.nasiyaPayment.findUnique({
              where: { shopId_idempotencyKey: { shopId, idempotencyKey } },
              // Do not use Prisma's default select: it would request the
              // stage-1 quote columns on an older local database. This replay
              // shape intentionally includes only columns that predate the
              // staged migration.
              select: {
                nasiyaId: true,
                nasiyaScheduleId: true,
                amount: true,
                paymentMethod: true,
                paymentBreakdown: true,
                paidAt: true,
                note: true,
                paymentInputAmount: true,
                paymentInputCurrency: true,
                appliedAmountInContractCurrency: true,
                paymentExchangeRate: true,
              },
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
                receipt: {
                  input: createMoneyDto(
                    existingPayment.paymentInputCurrency ?? 'UZS',
                    String(existingPayment.paymentInputAmount ?? existingPayment.amount),
                  ),
                  recordedUzs: createMoneyDto('UZS', String(existingPayment.amount)),
                  applied: existingPayment.appliedAmountInContractCurrency == null
                    ? null
                    : createMoneyDto(contractCurrency, String(existingPayment.appliedAmountInContractCurrency)),
                  paymentFxQuote: existingPayment.paymentExchangeRate == null
                    ? null
                    : createFxQuoteDto({
                        rate: String(existingPayment.paymentExchangeRate),
                        source: 'RECORDED_FROZEN',
                        effectiveAt: null,
                        fetchedAt: null,
                        freshness: 'FROZEN',
                      }),
                },
                ledger: {
                  paid: currentLedger.paid,
                  remaining: currentLedger.remaining,
                  status: currentLedger.status,
                },
                duplicate: true,
              }
            }
          }

          if (currentLedger.health === 'QUARANTINED') {
            throw { status: 409, message: "Nasiya hisob-kitobida tekshiruv talab qilinadigan tafovut bor" }
          }
          // Idempotent replays above must be returned before this terminal-state
          // guard; otherwise retrying the final successful payment reports 409.
          // A raw COMPLETED parent can be stale, so this uses schedule truth.
          if (currentLedger.status === 'COMPLETED') throw { status: 409, message: 'Bu nasiya yakunlangan' }

          const selectedSchedule = await tx.nasiyaSchedule.findFirst({
            where: { id: nasiyaScheduleId, nasiyaId, shopId },
          })
          if (!selectedSchedule) throw { status: 404, message: "To'lov jadvali topilmadi" }

          // Eligibility is contract-ledger-based, not a stored schedule label:
          // a legacy-derived PAID label must not prevent settling native debt.
          const ledgerScheduleById = new Map(currentLedger.schedules.map((schedule) => [schedule.id, schedule]))
          const unpaidSchedules = [...nasiya.schedules].filter((schedule) => (ledgerScheduleById.get(schedule.id)?.remaining.minorUnits ?? 0) > 0)
          const selectedOutstanding = ledgerScheduleById.get(selectedSchedule.id)?.remaining ?? createMoneyDto(contractCurrency, 0)
          const allocationLedgerStartedAt = performance.now()
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

          if (selectedOutstanding.minorUnits <= 0) {
            throw {
              status: 409,
              message: "Tanlangan oy to'lovi allaqachon yopilgan",
            }
          }
            // Compare against the complete reconciled schedule debt, never a
            // parent cache or UZS mirror. The selected schedule may overflow
            // into later rows, so this is intentionally not just its balance.
            const totalOutstandingContract = currentLedger.remaining
            if (appliedMoney.minorUnits > totalOutstandingContract.minorUnits) {
              throw {
                status: 409,
                message: "To'lov qolgan nasiya summasidan oshib ketdi",
              }
            }

            // Payment dates are audit evidence and may be backdated. Derived
            // overdue/partial status must instead use one server-clock instant
            // throughout this transaction; otherwise a backdated payment can
            // write a status that the immediately following reconciliation
            // quite correctly considers inconsistent.
            const ledgerNow = new Date()
            const scheduleUpdates = allocateNasiyaPayment({
              schedules: allocationRows.map((schedule) => ({
                id: schedule.id,
                monthNumber: schedule.monthNumber,
                dueDate: schedule.dueDate,
                delayedUntil: schedule.delayedUntil,
                expectedAmount: schedule.expectedAmount.toString(),
                paidAmount: schedule.paidAmount.toString(),
                contractExpectedAmount: schedule.contractExpectedAmount.toString(),
                contractPaidAmount: schedule.contractPaidAmount.toString(),
              })),
              amountUzs,
              appliedAmountInContractCurrency,
              contractCurrency,
              now: ledgerNow,
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
                paymentExchangeRate: paymentTimeRate,
                ...(paymentFxQuoteColumnsAvailable ? {
                  paymentExchangeRateSource: paymentTimeRateSource ?? (
                    inputCurrency === 'USD' && contractCurrency === 'USD'
                      ? 'UNAVAILABLE_SAME_CURRENCY'
                      : null
                  ),
                  paymentExchangeRateEffectiveAt: paymentTimeSnapshot?.effectiveAt ?? null,
                  paymentExchangeRateFetchedAt: paymentTimeSnapshot?.fetchedAt ?? null,
                } : {}),
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
          // Reconcile the authoritative schedule projection after every row,
          // allocation, and payment write. Parent totals are updated only as
          // a cache inside this same serializable transaction.
          const allSchedules = await tx.nasiyaSchedule.findMany({
            where: { nasiyaId },
          })
          const allAllocations = nasiya.accountingReconstructionStatus === 'COMPLETE'
            ? await tx.nasiyaPaymentAllocation.findMany({
                where: { nasiyaId },
                select: {
                  nasiyaScheduleId: true,
                  contractCurrency: true,
                  contractAmount: true,
                },
              })
            : []
          const legacyFinal = createMoneyDto('UZS', nasiya.finalNasiyaAmount.toString())
          const legacyPaidMinorUnits = allSchedules.reduce(
            (sum, schedule) => sum + createMoneyDto('UZS', schedule.paidAmount.toString()).minorUnits,
            0,
          )
          const remaining = moneyDtoToAmount({
            currency: 'UZS',
            minorUnits: Math.max(0, legacyFinal.minorUnits - legacyPaidMinorUnits),
          })
          const postPaymentLedger = reconcileNasiyaLedger({
            status: nasiya.status,
            contractCurrency,
            contractFinalAmount: nasiya.contractFinalAmount.toString(),
            contractPaidAmount: nasiya.contractPaidAmount.toString(),
            contractRemainingAmount: nasiya.contractRemainingAmount.toString(),
            schedules: allSchedules.map((schedule) => ({
              id: schedule.id,
              status: schedule.status,
              dueDate: schedule.dueDate,
              delayedUntil: schedule.delayedUntil,
              expectedAmount: schedule.expectedAmount.toString(),
              paidAmount: schedule.paidAmount.toString(),
              contractCurrency: schedule.contractCurrency,
              contractExpectedAmount: schedule.contractExpectedAmount.toString(),
              contractPaidAmount: schedule.contractPaidAmount.toString(),
              contractRemainingAmount: schedule.contractRemainingAmount.toString(),
            })),
            allocationHistoryComplete: nasiya.accountingReconstructionStatus === 'COMPLETE',
            allocations: allAllocations.map((allocation) => ({
              nasiyaScheduleId: allocation.nasiyaScheduleId,
              contractCurrency: allocation.contractCurrency,
              contractAmount: allocation.contractAmount.toString(),
            })),
          }, ledgerNow)
          if (postPaymentLedger.health === 'QUARANTINED') {
            throw { status: 409, message: "To'lovdan keyin nasiya jadvali mos kelmadi; amaliyot bekor qilindi" }
          }
          const newStatus = postPaymentLedger.status
          // The contract-complete guard above excludes an already-complete
          // contract, so reaching COMPLETED here is a real transition.
          const justCompleted = newStatus === 'COMPLETED'
          // The legacy UZS fields stay compatibility snapshots. Both parent
          // status and contract remainder above are decided only by native
          // contract schedule amounts, so an FX-rate move cannot close debt.
          const remainingToStore = newStatus === 'COMPLETED' ? 0 : remaining
          const contractPaidToStore = moneyDtoDatabaseAmount(postPaymentLedger.paid)
          const contractRemainingToStore = moneyDtoDatabaseAmount(postPaymentLedger.remaining)

          await tx.nasiya.update({
            where: { id: nasiyaId },
            data: {
              remainingAmount: remainingToStore,
              status: newStatus,
              contractPaidAmount: contractPaidToStore,
              contractRemainingAmount: contractRemainingToStore,
            },
          })
          timings.allocationLedgerReconciliation = (timings.allocationLedgerReconciliation ?? 0)
            + (performance.now() - allocationLedgerStartedAt)

          const notificationAuditStartedAt = performance.now()
          const recipients = await resolveTelegramRecipients(tx, {
            shopId,
            audience: TELEGRAM_AUDIENCES.OWNER_AND_ACTIVE_STAFF,
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
              paymentExchangeRate: paymentTimeRate,
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
          // Queue every recipient in one set-based write. Telegram delivery
          // remains post-response; serializable payment locks are no longer
          // held for two inserts per active administrator.
          const scheduledAt = new Date()
          // `if (completedMessage)`, each administrator receives one
          // completion row in addition to the ordinary payment row.
          const notificationRows = [
            ...telegramNotificationRows(recipients, {
              type: 'PAYMENT_RECEIVED',
              message: paymentMessage,
              scheduledAt,
              relatedId: allocations.length === 1 ? allocations[0].scheduleId : nasiyaId,
              relatedType: allocations.length === 1 ? 'NasiyaSchedule' : 'Nasiya',
            }),
            ...(completedMessage ? telegramNotificationRows(recipients, {
              type: 'NASIYA_COMPLETED',
              message: completedMessage,
              scheduledAt,
              relatedId: nasiyaId,
              relatedType: 'Nasiya',
            }) : []),
            ...telegramUnavailableMarkerRows(recipients, {
              type: 'PAYMENT_RECEIVED',
              dedupeScope: payment.id,
              cancelledAt: scheduledAt,
            }),
            ...(completedMessage ? telegramUnavailableMarkerRows(recipients, {
              type: 'NASIYA_COMPLETED',
              dedupeScope: payment.id,
              cancelledAt: scheduledAt,
            }) : []),
          ]
          if (notificationRows.length > 0) {
            await tx.notification.createMany({ data: notificationRows })
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
                inputCurrency: amountInput.inputCurrency,
                exchangeRateUsed: amountInput.exchangeRateUsed,
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
                note: 'Nasiya to‘liq yopildi',
              },
            })
          }
          timings.notificationsAudit = (timings.notificationsAudit ?? 0)
            + (performance.now() - notificationAuditStartedAt)

          return {
            nasiyaId,
            nasiyaScheduleId,
            receipt: {
              input: inputMoney,
              recordedUzs: amountUzsMoney,
              applied: appliedMoney,
              paymentFxQuote: conversionQuote,
            },
            ledger: {
              paid: postPaymentLedger.paid,
              remaining: postPaymentLedger.remaining,
              status: postPaymentLedger.status,
            },
            allocations: allocations.map((allocation) => ({
              scheduleId: allocation.scheduleId,
              monthNumber: allocation.monthNumber,
              applied: createMoneyDto(contractCurrency, allocation.contractAmount),
              recordedUzs: createMoneyDto('UZS', allocation.amount),
            })),
            duplicate: false,
          }
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      )

    const transactionStartedAt = performance.now()
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
    timings.serializableTransaction = performance.now() - transactionStartedAt
    if (!result) return serverError()

    const serializationStartedAt = performance.now()
    if (!result.duplicate) {
      invalidateShopPaymentMutation(shopId)
    }

    // Flush freshly-queued notifications after the response (non-blocking).
    // The rows are already committed, so cron is the backstop if this misses.
    after(() =>
      flushQueuedTelegramWork().catch((e) =>
        logger.warn('notification flush failed', {
          event: 'notification.flush_failed',
          error: e,
        }),
      ),
    )

    timings.serialization = performance.now() - serializationStartedAt
    const durationMs = performance.now() - startedAt
    if (process.env.PERFORMANCE_TIMING_LOGS === 'true' || durationMs >= 800) {
      logger.info('Nasiya payment performance timing', {
        event: 'performance.nasiya_payment',
        shopId: measuredShopId,
        durationMs: Math.round(durationMs),
        phasesMs: Object.fromEntries(Object.entries(timings).map(([phase, value]) => [phase, Math.round(value)])),
        status: result.duplicate ? 'idempotent_replay' : 'confirmed',
      })
    }
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
