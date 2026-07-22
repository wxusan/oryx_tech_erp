/**
 * GET   /api/nasiya/[id] — get a single nasiya with full details
 * PATCH /api/nasiya/[id] — edit SAFE nasiya fields only (note).
 *
 * Financial terms (finalNasiyaAmount, remainingAmount, paidAmount, schedule
 * amounts, interestPercent, downPayment, months) are NOT editable here — they
 * would rewrite money/payment history. Correcting those requires a dedicated
 * correction flow (future work). Reminder toggling lives in ./reminder.
 *
 * Auth: SHOP_ADMIN (scoped to their own shop) or SUPER_ADMIN
 */

import { NextRequest } from 'next/server'
import { z, ZodError } from 'zod'
import { prisma } from '@/lib/prisma'
import { requireShopAnyPermission } from '@/lib/api-auth'
import { ok, badRequest, forbidden, notFound, serverError } from '@/lib/api-helpers'
import { invalidateShopNasiyaMutation } from '@/lib/server/cache-tags'
import { normalizePhone } from '@/lib/phone'
import { phoneSchema } from '@/lib/validations'
import { computeNasiyaPaymentScore } from '@/lib/nasiya-payment-score'
import { getShopCurrencyContext } from '@/lib/server/currency'
import { computeCustomerTrustRatingFromFactors, isValidTrustTier, type CustomerTrustFactors } from '@/lib/nasiya-customer-trust'
import { logger } from '@/lib/logger'
import { principalHasPermission } from '@/lib/server/shop-access'
import { isPrivateUploadStoredKey } from '@/lib/server/private-upload-reference'
import { createFxQuoteDto, createMoneyDto, moneyDtoToAmount } from '@/lib/currency'
import { reconcileNasiyaLedger } from '@/lib/nasiya-ledger'
import { hasNasiyaPaymentFxQuoteColumns } from '@/lib/server/nasiya-payment-schema'
import { calculateNasiyaSettlement } from '@/lib/nasiya-settlement'
import { getCustomerTrustFactorsForList } from '@/lib/server/customer-trust-queries'
import { calculateNasiyaReturnQuote, nasiyaReturnLedgerHasBlockingReasons } from '@/lib/nasiya-return'
import type { ReturnReceiptSource } from '@/lib/return-accounting'

type RouteContext = { params: Promise<{ id: string }> }

const MAX_NASIYA_SCHEDULES = 60
const MAX_LEDGER_ALLOCATIONS = 1000
const MAX_DETAIL_PAYMENTS = 500
const MAX_RESOLUTION_EVENTS = 100

const forbiddenMoneyFields = [
  'totalAmount',
  'downPayment',
  'baseRemainingAmount',
  'interestPercent',
  'interestAmount',
  'finalNasiyaAmount',
  'remainingAmount',
  'months',
  'monthlyPayment',
] as const

const updateNasiyaSchema = z.object({
  customerName: z.string().trim().min(2, "Mijoz ismi kamida 2 ta harfdan iborat bo'lishi kerak").max(100).optional(),
  customerPhone: phoneSchema.optional(),
  // A submitted blank is an intentional clear. Persist null rather than a
  // misleading empty-string comment, while an omitted field still means
  // "leave this value unchanged".
  note: z.string().trim().max(1000, "Izoh 1000 belgidan oshmasligi kerak").optional().transform((value) => value === undefined ? undefined : value || null),
  importNote: z.string().trim().max(1000, "Import izohi 1000 belgidan oshmasligi kerak").optional().transform((value) => value === undefined ? undefined : value || null),
  reminderEnabled: z.boolean().optional(),
  // Retained for API compatibility with older clients. It is ordinary edit
  // context, never a mandatory reason for a financial correction.
  reason: z.string().trim().max(1000, "Sabab 1000 ta belgidan oshmasligi kerak").optional().transform((value) => value || undefined),
})

function mapPaymentBreakdown(value: unknown, currency: 'UZS' | 'USD') {
  if (!Array.isArray(value)) return null
  return value.flatMap((part) => {
    if (!part || typeof part !== 'object') return []
    const row = part as { method?: unknown; amount?: unknown }
    if (typeof row.method !== 'string' || (typeof row.amount !== 'number' && typeof row.amount !== 'string')) return []
    try {
      return [{ method: row.method, amount: createMoneyDto(currency, row.amount) }]
    } catch {
      return []
    }
  })
}

function mapReturnReceiptSource(payment: {
  id: string
  paidAt: Date
  paymentMethod: 'CASH' | 'TRANSFER' | 'CARD' | 'OTHER' | null
  paymentBreakdown: unknown
  amount: { toString(): string }
  paymentInputAmount: { toString(): string } | null
  paymentExchangeRate: { toString(): string } | null
  appliedAmountInContractCurrency: { toString(): string } | null
}): ReturnReceiptSource {
  return {
    id: payment.id,
    kind: 'NASIYA',
    paidAt: payment.paidAt,
    paymentMethod: payment.paymentMethod,
    paymentBreakdown: payment.paymentBreakdown,
    amountUzs: Number(payment.amount),
    paymentInputAmount: payment.paymentInputAmount == null ? null : Number(payment.paymentInputAmount),
    paymentExchangeRate: payment.paymentExchangeRate == null ? null : Number(payment.paymentExchangeRate),
    appliedContractAmount: payment.appliedAmountInContractCurrency == null
      ? null
      : Number(payment.appliedAmountInContractCurrency),
  }
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  try {
    const guarded = await requireShopAnyPermission([
      'NASIYA_VIEW',
      'NASIYA_CREATE',
      'NASIYA_EDIT',
      'NASIYA_PAYMENT_RECEIVE',
      'NASIYA_RETURN_REFUND',
      'NASIYA_DEFER',
      'NASIYA_REMINDER_MANAGE',
      'NASIYA_ARCHIVE',
      'NASIYA_REOPEN',
    ])
    if (!guarded.ok) return guarded.response
    const { session } = guarded
    const includeResolutionData = session.user.role === 'SUPER_ADMIN' ||
      guarded.principal?.memberKind === 'SHOP_OWNER' || Boolean(
        guarded.principal && ['NASIYA_ARCHIVE', 'NASIYA_REOPEN'].some((permission) => (
          principalHasPermission(guarded.principal!, permission as 'NASIYA_ARCHIVE' | 'NASIYA_REOPEN')
        )),
      )
    const includeProfileData = session.user.role === 'SUPER_ADMIN' ||
      guarded.principal?.memberKind === 'SHOP_OWNER' || Boolean(
        guarded.principal && [
          'NASIYA_VIEW',
          'NASIYA_EDIT',
          'NASIYA_RETURN_REFUND',
          'NASIYA_REMINDER_MANAGE',
          'NASIYA_ARCHIVE',
          'NASIYA_REOPEN',
        ].some((permission) => principalHasPermission(
          guarded.principal!,
          permission as 'NASIYA_VIEW' | 'NASIYA_EDIT' | 'NASIYA_RETURN_REFUND' | 'NASIYA_REMINDER_MANAGE' |
            'NASIYA_ARCHIVE' | 'NASIYA_REOPEN',
        )),
      )
    const includePaymentHistory = includeProfileData || session.user.role === 'SUPER_ADMIN' || Boolean(
      guarded.principal && principalHasPermission(guarded.principal, 'NASIYA_PAYMENT_RECEIVE'),
    )
    const canSettleNasiya = session.user.role === 'SUPER_ADMIN' || Boolean(
      guarded.principal && principalHasPermission(guarded.principal, 'NASIYA_PAYMENT_RECEIVE'),
    )
    const canReturnNasiya = session.user.role === 'SUPER_ADMIN' || Boolean(
      guarded.principal && principalHasPermission(guarded.principal, 'NASIYA_RETURN_REFUND'),
    )
    const includeCustomerTrust = session.user.role === 'SUPER_ADMIN' ||
      guarded.principal?.memberKind === 'SHOP_OWNER' || Boolean(
        guarded.principal && principalHasPermission(guarded.principal, 'NASIYA_VIEW'),
      )
    const canViewPassportPhoto = session.user.role === 'SUPER_ADMIN' || Boolean(
      guarded.principal && principalHasPermission(guarded.principal, 'CUSTOMER_PASSPORT_PHOTO_VIEW'),
    )
    // The detail screen uses this explicit lightweight view for its first
    // render. Keep the default response complete for existing API consumers
    // and only defer histories/trust/audit-sensitive projections when the
    // caller knowingly asks for the summary.
    const summaryOnly = req.nextUrl.searchParams.get('view') === 'summary'
    const includeResolutionEvents = includeResolutionData && !summaryOnly
    const includePaymentDetails = includePaymentHistory && !summaryOnly
    const includeReturnReceiptEvidence = canReturnNasiya
    const includeFinancialPayments = includePaymentDetails || includeReturnReceiptEvidence
    const includeCustomerTrustData = includeCustomerTrust && !summaryOnly
    const includePaymentScore = includeProfileData && !summaryOnly

    const { id: nasiyaId } = await ctx.params
    // Do not query the additive column until its migration is applied. This
    // keeps older local/prod databases readable during the review-only repair
    // phase; after a deployment the process restarts and detects the column.
    const paymentFxQuoteColumnsAvailable = includePaymentDetails
      ? await hasNasiyaPaymentFxQuoteColumns()
      : false

    const nasiya = await prisma.nasiya.findFirst({
      where: {
        id: nasiyaId,
        deletedAt: null,
        shop: { status: 'ACTIVE', deletedAt: null },
        ...(session.user.role === 'SHOP_ADMIN' ? { shopId: session.user.shopId ?? '' } : {}),
      },
      select: {
        id: true,
        shopId: true,
        totalAmount: true,
        downPayment: true,
        baseRemainingAmount: true,
        interestPercent: true,
        interestAmount: true,
        finalNasiyaAmount: true,
        remainingAmount: true,
        // Native contract-currency ledger — the actual source of truth for
        // debt/schedule math. See docs/currency-accounting-model.md.
        contractCurrency: true,
        contractExchangeRateAtCreation: true,
        contractTotalAmount: true,
        contractDownPayment: true,
        contractBaseRemainingAmount: true,
        contractInterestAmount: true,
        contractFinalAmount: true,
        contractMonthlyPayment: true,
        contractRemainingAmount: true,
        contractPaidAmount: true,
        contractInterestWaivedAmount: true,
        interestWaivedAmount: true,
        accountingReconstructionStatus: true,
        status: true,
        returnedAt: true,
        returnedBy: true,
        resolutionState: true,
        resolutionUpdatedAt: true,
        ...(includeProfileData ? {
          reminderEnabled: true,
          note: true,
          isImported: true,
          importSource: true,
          importedAt: true,
          originalSaleDate: true,
          originalTotalAmount: true,
          alreadyPaidBeforeImport: true,
          remainingAtImport: true,
          importNote: true,
        } : {}),
        customer: {
          select: {
            id: true,
            name: true,
            phone: true,
            ...(canViewPassportPhoto ? { passportPhotoUrl: true } : {}),
            ...(includeCustomerTrustData ? { trustOverride: true } : {}),
          },
        },
        device: {
          select: {
            id: true,
            model: true,
            status: true,
          },
        },
        schedules: {
          orderBy: { monthNumber: 'asc' },
          take: MAX_NASIYA_SCHEDULES + 1,
          select: {
            id: true,
            monthNumber: true,
            dueDate: true,
            delayedUntil: true,
            expectedAmount: true,
            paidAmount: true,
            status: true,
            paidAt: true,
            contractExpectedAmount: true,
            contractPaidAmount: true,
            contractInterestWaivedAmount: true,
            contractRemainingAmount: true,
            interestWaivedAmount: true,
            contractPrincipalAmount: true,
            contractMarginAmount: true,
            contractInterestAmount: true,
            contractPrincipalPaidAmount: true,
            contractMarginPaidAmount: true,
            contractInterestPaidAmount: true,
          },
        },
        paymentAllocations: {
          orderBy: { id: 'asc' },
          take: MAX_LEDGER_ALLOCATIONS + 1,
          select: {
            nasiyaScheduleId: true,
            contractCurrency: true,
            contractAmount: true,
          },
        },
        ...(includeFinancialPayments ? { payments: {
          where: { deletedAt: null },
          orderBy: { paidAt: 'desc' },
          take: MAX_DETAIL_PAYMENTS + 1,
          select: {
            id: true,
            amount: true,
            paymentMethod: true,
            paymentBreakdown: true,
            paidAt: true,
            note: true,
            nasiyaScheduleId: true,
            paymentInputAmount: true,
            paymentInputCurrency: true,
            paymentExchangeRate: true,
            ...(paymentFxQuoteColumnsAvailable ? {
              paymentExchangeRateSource: true,
              paymentExchangeRateEffectiveAt: true,
              paymentExchangeRateFetchedAt: true,
            } : {}),
            appliedAmountInContractCurrency: true,
          },
        } } : {}),
        returns: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            createdAt: true,
            contractCurrency: true,
            contractReceiptsAtReturn: true,
            contractRefundAmount: true,
            contractRetainedAmount: true,
            contractCancelledDebt: true,
            refundAmount: true,
            retainedValueAmountUzs: true,
            refundMethod: true,
            note: true,
            createdBy: true,
          },
        },
        settlement: {
          select: {
            id: true,
            mode: true,
            contractCurrency: true,
            contractRemainingBefore: true,
            contractCashReceivedAmount: true,
            contractInterestWaivedAmount: true,
            contractRemainingAfter: true,
            cashReceivedAmountUzs: true,
            interestWaivedAmountUzs: true,
            settledAt: true,
            reason: true,
            actorId: true,
            actorType: true,
            ...(summaryOnly ? {} : {
              allocations: {
                orderBy: { sequence: 'asc' as const },
                take: MAX_NASIYA_SCHEDULES + 1,
                select: {
                  id: true,
                  nasiyaScheduleId: true,
                  sequence: true,
                  contractRemainingBefore: true,
                  contractCashAmount: true,
                  contractInterestWaivedAmount: true,
                  contractRemainingAfter: true,
                  cashAmountUzs: true,
                  interestWaivedAmountUzs: true,
                },
              },
            }),
          },
        },
      },
    })

    if (
      !nasiya ||
      (nasiya.status === 'CANCELLED' && !nasiya.returnedAt) ||
      (nasiya.resolutionState === 'WRITTEN_OFF' && !nasiya.returnedAt)
    ) {
      // Keep immutable legacy ledger rows in the database, but do not expose
      // cancelled/write-off contracts through the active Nasiya surface.
      return notFound('Nasiya topilmadi')
    }
    const boundedHistoryExceeded = nasiya.schedules.length > MAX_NASIYA_SCHEDULES ||
      nasiya.paymentAllocations.length > MAX_LEDGER_ALLOCATIONS
    const paymentHistoryTruncated = 'payments' in nasiya && nasiya.payments.length > MAX_DETAIL_PAYMENTS
    if (nasiya.schedules.length > MAX_NASIYA_SCHEDULES) nasiya.schedules.splice(MAX_NASIYA_SCHEDULES)
    if (nasiya.paymentAllocations.length > MAX_LEDGER_ALLOCATIONS) nasiya.paymentAllocations.splice(MAX_LEDGER_ALLOCATIONS)
    if ('payments' in nasiya && nasiya.payments.length > MAX_DETAIL_PAYMENTS) nasiya.payments.splice(MAX_DETAIL_PAYMENTS)

    // Resolution events contain immutable archive financial/audit context.
    // Staff may operate active Nasiyas but must not
    // receive this owner-only ledger payload even through a direct URL.
    const resolutionEvents = includeResolutionEvents
      ? await prisma.nasiyaResolutionEvent.findMany({
          where: { shopId: nasiya.shopId, nasiyaId: nasiya.id },
          orderBy: { createdAt: 'desc' },
          take: MAX_RESOLUTION_EVENTS + 1,
          select: {
            id: true,
            eventType: true,
            previousState: true,
            newState: true,
            contractCurrency: true,
            nativeRemainingAmount: true,
            frozenUzsAmount: true,
            frozenUsdUzsRate: true,
            reason: true,
            actorId: true,
            actorType: true,
            reversesEventId: true,
            createdAt: true,
          },
        })
      : []
    const resolutionHistoryTruncated = resolutionEvents.length > MAX_RESOLUTION_EVENTS
    if (resolutionHistoryTruncated) resolutionEvents.splice(MAX_RESOLUTION_EVENTS)

    // One projection is the only source for detail status, progress, payment
    // validation data, and the parent-cache health badge. Do not re-add raw
    // Decimal fields in React: all amounts below are mapped to MoneyDto.
    const ledger = reconcileNasiyaLedger({
      status: nasiya.status,
      contractCurrency: nasiya.contractCurrency,
      contractFinalAmount: nasiya.contractFinalAmount.toString(),
      contractPaidAmount: nasiya.contractPaidAmount.toString(),
      contractInterestWaivedAmount: nasiya.contractInterestWaivedAmount.toString(),
      contractRemainingAmount: nasiya.contractRemainingAmount.toString(),
      schedules: nasiya.schedules.map((schedule) => ({
        id: schedule.id,
        status: schedule.status,
        dueDate: schedule.dueDate,
        delayedUntil: schedule.delayedUntil,
        expectedAmount: schedule.expectedAmount.toString(),
        paidAmount: schedule.paidAmount.toString(),
        contractCurrency: nasiya.contractCurrency,
        contractExpectedAmount: schedule.contractExpectedAmount.toString(),
        contractPaidAmount: schedule.contractPaidAmount.toString(),
        contractInterestWaivedAmount: schedule.contractInterestWaivedAmount.toString(),
        contractRemainingAmount: schedule.contractRemainingAmount.toString(),
      })),
      allocationHistoryComplete: nasiya.accountingReconstructionStatus === 'COMPLETE' && !boundedHistoryExceeded,
      allocations: nasiya.paymentAllocations.map((allocation) => ({
        nasiyaScheduleId: allocation.nasiyaScheduleId,
        contractCurrency: allocation.contractCurrency,
        contractAmount: allocation.contractAmount.toString(),
      })),
    })

    const returned = nasiya.returnedAt != null
    const returnRecord = nasiya.returns[0]
      ? {
          id: nasiya.returns[0].id,
          returnedAt: nasiya.returns[0].createdAt.toISOString(),
          contractCurrency: nasiya.returns[0].contractCurrency,
          receipts: createMoneyDto(nasiya.returns[0].contractCurrency, nasiya.returns[0].contractReceiptsAtReturn.toString()),
          refund: createMoneyDto(nasiya.returns[0].contractCurrency, nasiya.returns[0].contractRefundAmount.toString()),
          retained: createMoneyDto(nasiya.returns[0].contractCurrency, nasiya.returns[0].contractRetainedAmount.toString()),
          cancelledDebt: createMoneyDto(nasiya.returns[0].contractCurrency, nasiya.returns[0].contractCancelledDebt.toString()),
          refundUzs: createMoneyDto('UZS', nasiya.returns[0].refundAmount.toString()),
          retainedUzs: createMoneyDto('UZS', nasiya.returns[0].retainedValueAmountUzs.toString()),
          refundMethod: nasiya.returns[0].refundMethod,
          reason: nasiya.returns[0].note,
          actorId: nasiya.returns[0].createdBy,
        }
      : null
    const rawReturnQuote = canReturnNasiya && !returned
      ? calculateNasiyaReturnQuote({
            contractCurrency: nasiya.contractCurrency,
            contractDownPayment: Number(nasiya.contractDownPayment),
            cancelledDebt: moneyDtoToAmount(ledger.remaining),
            contractExchangeRateAtCreation: Number(nasiya.contractExchangeRateAtCreation ?? 0) || null,
            accountingReconstructionStatus: nasiya.accountingReconstructionStatus,
            resolutionState: nasiya.resolutionState,
            deviceStatus: nasiya.device.status,
            sources: (nasiya.payments ?? []).map(mapReturnReceiptSource),
          })
      : null
    const returnQuote = rawReturnQuote && (paymentHistoryTruncated || nasiyaReturnLedgerHasBlockingReasons(ledger.reasons))
      ? {
          ...rawReturnQuote,
          eligible: false,
          ineligibilityReason: paymentHistoryTruncated
            ? "Nasiya tushumlari tasdiqlangan chegaradan oshgan; avval tekshiruv kerak"
            : "Nasiya hisob-kitobida tekshiruv talab qilinadigan tafovut bor",
        }
      : rawReturnQuote

    // Reason text must respect the shop's selected display currency, not
    // hardcode UZS — see docs/nasiya-payment-scoring.md. The score itself
    // must read the deal's own contract-currency amounts (never the legacy
    // UZS snapshot) — see docs/currency-accounting-model.md.
    const [scoreCurrencyContext, trustFactorMap] = await Promise.all([
      includePaymentScore ? getShopCurrencyContext(nasiya.shopId) : Promise.resolve(null),
      includeCustomerTrustData
        ? getCustomerTrustFactorsForList({ shopId: nasiya.shopId, customerIds: [nasiya.customer.id] })
        : Promise.resolve(new Map<string, CustomerTrustFactors>()),
    ])
    const paymentScore = includePaymentScore && scoreCurrencyContext
      ? computeNasiyaPaymentScore(
          {
            schedules: nasiya.schedules.map((s) => ({
              status: s.status,
              dueDate: s.dueDate,
              delayedUntil: s.delayedUntil,
              expectedAmount: Number(s.contractExpectedAmount),
              paidAmount: Number(s.contractPaidAmount),
              interestWaivedAmount: Number(s.contractInterestWaivedAmount),
              paidAt: s.paidAt,
            })),
          },
          new Date(),
          scoreCurrencyContext,
          nasiya.contractCurrency,
        )
      : null

    // Item 12 — customer trust rating, aggregated across ALL of this
    // customer's nasiyas in this shop (not just this one deal).
    const trustOverrideValue = 'trustOverride' in nasiya.customer ? nasiya.customer.trustOverride : null
    const trustOverride = isValidTrustTier(trustOverrideValue) ? trustOverrideValue : null
    const fallbackTrustFactors: CustomerTrustFactors = {
      totalNasiyaCount: 0,
      completedNasiyaCount: 0,
      activeNasiyaCount: 0,
      cancelledNasiyaCount: 0,
      paidInstallmentCount: 0,
      onTimeRatio: null,
      lateInstallmentCount: 0,
      maxDaysLate: 0,
      currentOverdueScheduleCount: 0,
      hasCurrentOverdue: false,
    }
    const customerTrust = includeCustomerTrustData
      ? computeCustomerTrustRatingFromFactors(
          trustFactorMap.get(nasiya.customer.id) ?? fallbackTrustFactors,
          trustOverride,
        )
      : null
    const passportPhotoUrl = 'passportPhotoUrl' in nasiya.customer ? nasiya.customer.passportPhotoUrl : null
    const customer = {
      id: nasiya.customer.id,
      name: nasiya.customer.name,
      phone: nasiya.customer.phone,
      ...(canViewPassportPhoto ? { hasPassportPhoto: isPrivateUploadStoredKey({ key: passportPhotoUrl, shopId: nasiya.shopId, kind: 'passport' }) } : {}),
    }
    let settlementQuotes: {
      full: ReturnType<typeof calculateNasiyaSettlement>
      waive: ReturnType<typeof calculateNasiyaSettlement>
    } | null = null
    if (
      canSettleNasiya &&
      !returned &&
      !nasiya.settlement &&
      nasiya.resolutionState === 'ACTIVE' &&
      ledger.status !== 'COMPLETED' &&
      ledger.health !== 'QUARANTINED' &&
      ledger.remaining.minorUnits > 0
    ) {
      const settlementInput = {
        contractCurrency: nasiya.contractCurrency,
        contractRemainingAmount: nasiya.contractRemainingAmount.toString(),
        contractPaidAmount: nasiya.contractPaidAmount.toString(),
        contractInterestWaivedAmount: nasiya.contractInterestWaivedAmount.toString(),
        accountingReconstructionStatus: nasiya.accountingReconstructionStatus,
        schedules: nasiya.schedules.map((schedule) => ({
          id: schedule.id,
          monthNumber: schedule.monthNumber,
          contractExpectedAmount: schedule.contractExpectedAmount.toString(),
          contractPaidAmount: schedule.contractPaidAmount.toString(),
          contractRemainingAmount: schedule.contractRemainingAmount.toString(),
          contractInterestWaivedAmount: schedule.contractInterestWaivedAmount.toString(),
          contractPrincipalAmount: schedule.contractPrincipalAmount.toString(),
          contractMarginAmount: schedule.contractMarginAmount.toString(),
          contractInterestAmount: schedule.contractInterestAmount.toString(),
          contractPrincipalPaidAmount: schedule.contractPrincipalPaidAmount.toString(),
          contractMarginPaidAmount: schedule.contractMarginPaidAmount.toString(),
          contractInterestPaidAmount: schedule.contractInterestPaidAmount.toString(),
        })),
      } as const
      try {
        settlementQuotes = {
          full: calculateNasiyaSettlement({ ...settlementInput, mode: 'FULL_WITH_PROFIT' }),
          waive: calculateNasiyaSettlement({ ...settlementInput, mode: 'WAIVE_REMAINING_PROFIT' }),
        }
      } catch (error) {
        logger.warn('Nasiya settlement quote was quarantined', {
          event: 'nasiya.settlement_quote_quarantined',
          shopId: nasiya.shopId,
          nasiyaId: nasiya.id,
          error,
        })
      }
    }
    const reconciledScheduleById = new Map(ledger.schedules.map((schedule) => [schedule.id, schedule]))
    const responseSchedules = nasiya.schedules.map((schedule) => {
      const reconciled = reconciledScheduleById.get(schedule.id)
      // A malformed row is quarantined by `ledger`; still return a safe,
      // zero-valued DTO rather than a raw Decimal to the browser.
      const fallback = {
        expected: createMoneyDto(nasiya.contractCurrency, 0),
        paid: createMoneyDto(nasiya.contractCurrency, 0),
        waived: createMoneyDto(nasiya.contractCurrency, 0),
        remaining: createMoneyDto(nasiya.contractCurrency, 0),
      }
      return {
        id: schedule.id,
        monthNumber: schedule.monthNumber,
        dueDate: schedule.dueDate.toISOString(),
        delayedUntil: schedule.delayedUntil?.toISOString() ?? null,
        status: schedule.status,
        paidAt: schedule.paidAt?.toISOString() ?? null,
        expected: reconciled?.expected ?? fallback.expected,
        paid: reconciled?.paid ?? fallback.paid,
        waived: reconciled?.waived ?? fallback.waived,
        remaining: reconciled?.remaining ?? fallback.remaining,
        // Explicit legacy mirrors are read-only reporting context; native
        // schedule DTOs above remain the debt source of truth.
        legacyExpected: createMoneyDto('UZS', schedule.expectedAmount.toString()),
        legacyPaid: createMoneyDto('UZS', schedule.paidAmount.toString()),
        legacyWaived: createMoneyDto('UZS', schedule.interestWaivedAmount.toString()),
      }
    })
    const responsePayments = includePaymentDetails
      ? (nasiya.payments ?? []).map((payment) => ({
          id: payment.id,
          paymentMethod: payment.paymentMethod,
          paymentBreakdown: mapPaymentBreakdown(payment.paymentBreakdown, payment.paymentInputCurrency ?? 'UZS'),
          paidAt: payment.paidAt.toISOString(),
          note: payment.note,
          nasiyaScheduleId: payment.nasiyaScheduleId,
          recordedUzs: createMoneyDto('UZS', payment.amount.toString()),
          input: payment.paymentInputAmount != null && payment.paymentInputCurrency
            ? createMoneyDto(payment.paymentInputCurrency, payment.paymentInputAmount.toString())
            : null,
          applied: payment.appliedAmountInContractCurrency != null
            ? createMoneyDto(nasiya.contractCurrency, payment.appliedAmountInContractCurrency.toString())
            : null,
          paymentFxQuote: payment.paymentExchangeRate != null
            ? createFxQuoteDto({
                rate: payment.paymentExchangeRate.toString(),
                // Older rows predate auditable provider/timestamp metadata.
                // Preserve their frozen number, but never invent when it was
                // fetched or which provider supplied it.
                source: ('paymentExchangeRateSource' in payment && payment.paymentExchangeRateSource) || 'RECORDED_FROZEN',
                effectiveAt: ('paymentExchangeRateEffectiveAt' in payment && payment.paymentExchangeRateEffectiveAt)
                  ? payment.paymentExchangeRateEffectiveAt.toISOString()
                  : null,
                fetchedAt: ('paymentExchangeRateFetchedAt' in payment && payment.paymentExchangeRateFetchedAt)
                  ? payment.paymentExchangeRateFetchedAt.toISOString()
                  : null,
                freshness: 'FROZEN',
              })
            : null,
        }))
      : undefined
    const profileData = includeProfileData
      ? {
          reminderEnabled: nasiya.reminderEnabled,
          note: nasiya.note,
          importData: {
            isImported: nasiya.isImported,
            source: nasiya.importSource,
            importedAt: nasiya.importedAt?.toISOString() ?? null,
            originalSaleDate: nasiya.originalSaleDate?.toISOString() ?? null,
            originalTotal: nasiya.originalTotalAmount == null ? null : createMoneyDto('UZS', nasiya.originalTotalAmount.toString()),
            alreadyPaid: createMoneyDto('UZS', nasiya.alreadyPaidBeforeImport.toString()),
            remainingAtImport: nasiya.remainingAtImport == null ? null : createMoneyDto('UZS', nasiya.remainingAtImport.toString()),
            note: nasiya.importNote,
          },
        }
      : {}

    return ok(
      {
        id: nasiya.id,
        shopId: nasiya.shopId,
        contractCurrency: nasiya.contractCurrency,
        status: ledger.status,
        returnedAt: nasiya.returnedAt?.toISOString() ?? null,
        returnedBy: nasiya.returnedBy,
        resolutionState: nasiya.resolutionState,
        resolutionUpdatedAt: nasiya.resolutionUpdatedAt?.toISOString() ?? null,
        contractTerms: {
          original: createMoneyDto(nasiya.contractCurrency, nasiya.contractTotalAmount.toString()),
          downPayment: createMoneyDto(nasiya.contractCurrency, nasiya.contractDownPayment.toString()),
          principal: createMoneyDto(nasiya.contractCurrency, nasiya.contractBaseRemainingAmount.toString()),
          interest: createMoneyDto(nasiya.contractCurrency, nasiya.contractInterestAmount.toString()),
          financed: ledger.financed,
          monthly: createMoneyDto(nasiya.contractCurrency, nasiya.contractMonthlyPayment.toString()),
          interestPercent: Number(nasiya.interestPercent),
        },
        ledger,
        customer,
        device: nasiya.device,
        schedules: responseSchedules,
        settlementQuotes,
        returnQuote,
        returnRecord,
        settlement: nasiya.settlement
          ? {
              id: nasiya.settlement.id,
              mode: nasiya.settlement.mode,
              contractCurrency: nasiya.settlement.contractCurrency,
              remainingBefore: createMoneyDto(nasiya.settlement.contractCurrency, nasiya.settlement.contractRemainingBefore.toString()),
              cashReceived: createMoneyDto(nasiya.settlement.contractCurrency, nasiya.settlement.contractCashReceivedAmount.toString()),
              interestWaived: createMoneyDto(nasiya.settlement.contractCurrency, nasiya.settlement.contractInterestWaivedAmount.toString()),
              remainingAfter: createMoneyDto(nasiya.settlement.contractCurrency, nasiya.settlement.contractRemainingAfter.toString()),
              cashReceivedUzs: createMoneyDto('UZS', nasiya.settlement.cashReceivedAmountUzs.toString()),
              interestWaivedUzs: createMoneyDto('UZS', nasiya.settlement.interestWaivedAmountUzs.toString()),
              settledAt: nasiya.settlement.settledAt.toISOString(),
              reason: nasiya.settlement.reason,
              actorId: nasiya.settlement.actorId,
              actorType: nasiya.settlement.actorType,
              ...('allocations' in nasiya.settlement
                ? {
                    allocations: nasiya.settlement.allocations.map((allocation) => ({
                      id: allocation.id,
                      nasiyaScheduleId: allocation.nasiyaScheduleId,
                      sequence: allocation.sequence,
                      remainingBefore: createMoneyDto(nasiya.settlement!.contractCurrency, allocation.contractRemainingBefore.toString()),
                      cash: createMoneyDto(nasiya.settlement!.contractCurrency, allocation.contractCashAmount.toString()),
                      interestWaived: createMoneyDto(nasiya.settlement!.contractCurrency, allocation.contractInterestWaivedAmount.toString()),
                      remainingAfter: createMoneyDto(nasiya.settlement!.contractCurrency, allocation.contractRemainingAfter.toString()),
                      cashUzs: createMoneyDto('UZS', allocation.cashAmountUzs.toString()),
                      interestWaivedUzs: createMoneyDto('UZS', allocation.interestWaivedAmountUzs.toString()),
                    })),
                  }
                : {}),
            }
          : null,
        ...(responsePayments ? { payments: responsePayments } : {}),
        ...(includePaymentDetails ? { paymentHistoryTruncated } : {}),
        ...profileData,
        displayStatus: returned ? 'RETURNED' : ledger.status,
        isOverdue: ledger.isOverdue,
        overdueAmount: ledger.overdue,
        ...(paymentScore ? { paymentScore } : {}),
        ...(customerTrust ? { customerTrust } : {}),
        ...(includeResolutionData && !summaryOnly
          ? {
              resolutionEvents: resolutionEvents.map((event) => ({
                id: event.id,
                eventType: event.eventType,
                previousState: event.previousState,
                newState: event.newState,
                contractCurrency: event.contractCurrency,
                nativeRemaining: createMoneyDto(event.contractCurrency, event.nativeRemainingAmount.toString()),
                frozenUzs: createMoneyDto('UZS', event.frozenUzsAmount.toString()),
                frozenFxQuote: createFxQuoteDto({
                  rate: event.frozenUsdUzsRate.toString(),
                  source: 'CONTRACT_FROZEN',
                  effectiveAt: event.createdAt.toISOString(),
                  fetchedAt: event.createdAt.toISOString(),
                  freshness: 'FRESH',
                }),
                reason: event.reason,
                actorId: event.actorId,
                actorType: event.actorType,
                reversesEventId: event.reversesEventId,
                createdAt: event.createdAt.toISOString(),
              })),
              resolutionHistoryTruncated,
            }
          : {}),
      },
      "Nasiya ma'lumotlari",
    )
  } catch (err) {
    logger.error('[GET /api/nasiya/[id]]', { event: 'api.route_error', error: err })
    return serverError()
  }
}

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  try {
    const guarded = await requireShopAnyPermission(['NASIYA_EDIT', 'NASIYA_REMINDER_MANAGE'])
    if (!guarded.ok) return guarded.response
    const { session } = guarded

    const { id: nasiyaId } = await ctx.params
    const body: unknown = await req.json()
    if (body && typeof body === 'object') {
      const forbidden = forbiddenMoneyFields.find((field) => field in body)
      if (forbidden) {
        return badRequest("Pul summalari to'lovlar va hisobotlarga bog'langan. Ularni tuzatish uchun alohida tasdiqlangan moliyaviy tuzatish amali kerak.")
      }
    }
    const parsed = updateNasiyaSchema.safeParse(body)
    if (!parsed.success) {
      const firstError = (parsed.error as ZodError).issues[0]?.message ?? "Noto'g'ri ma'lumot"
      return badRequest(firstError)
    }
    const hasOrdinaryEdit = parsed.data.customerName !== undefined || parsed.data.customerPhone !== undefined ||
      parsed.data.note !== undefined || parsed.data.importNote !== undefined || parsed.data.reason !== undefined
    if (
      session.user.role !== 'SUPER_ADMIN' &&
      ((hasOrdinaryEdit && (!guarded.principal || !principalHasPermission(guarded.principal, 'NASIYA_EDIT'))) ||
        (parsed.data.reminderEnabled !== undefined && (!guarded.principal || !principalHasPermission(guarded.principal, 'NASIYA_REMINDER_MANAGE'))))
    ) {
      return forbidden("So'rovdagi barcha nasiya o'zgarishlari uchun alohida ruxsat kerak")
    }
    if (
      parsed.data.customerName === undefined &&
      parsed.data.customerPhone === undefined &&
      parsed.data.note === undefined &&
      parsed.data.importNote === undefined &&
      parsed.data.reminderEnabled === undefined
    ) {
      return badRequest("O'zgartirish uchun ma'lumot kiritilmadi")
    }

    const existing = await prisma.nasiya.findFirst({
      where: {
        id: nasiyaId,
        deletedAt: null,
        shop: { status: 'ACTIVE', deletedAt: null },
        ...(session.user.role === 'SHOP_ADMIN' ? { shopId: session.user.shopId ?? '' } : {}),
      },
      select: {
        id: true,
        shopId: true,
        customerId: true,
        note: true,
        importNote: true,
        reminderEnabled: true,
        customer: { select: { name: true, phone: true, normalizedPhone: true } },
      },
    })
    if (!existing) return notFound('Nasiya topilmadi')

    const updated = await prisma.$transaction(async (tx) => {
      const customerUpdate = {
        ...(parsed.data.customerName !== undefined ? { name: parsed.data.customerName } : {}),
        ...(parsed.data.customerPhone !== undefined
          ? { phone: parsed.data.customerPhone, normalizedPhone: normalizePhone(parsed.data.customerPhone) }
          : {}),
      }
      if (Object.keys(customerUpdate).length > 0) {
        await tx.customer.update({ where: { id: existing.customerId }, data: customerUpdate })
      }
      const nasiyaUpdate = {
        ...(parsed.data.note !== undefined ? { note: parsed.data.note } : {}),
        ...(parsed.data.importNote !== undefined ? { importNote: parsed.data.importNote } : {}),
        ...(parsed.data.reminderEnabled !== undefined ? { reminderEnabled: parsed.data.reminderEnabled } : {}),
      }
      const nasiya = await tx.nasiya.update({
        where: { id: existing.id },
        data: nasiyaUpdate,
        select: {
          id: true,
          note: true,
          importNote: true,
          reminderEnabled: true,
          customer: { select: { name: true, phone: true } },
        },
      })
      await tx.log.create({
        data: {
          shopId: existing.shopId,
          actorId: session.user.id,
          actorType: session.user.role as 'SUPER_ADMIN' | 'SHOP_ADMIN',
          action: 'UPDATE',
          targetType: 'Nasiya',
          targetId: existing.id,
          oldValue: {
            customerName: existing.customer.name,
            customerPhone: existing.customer.phone,
            note: existing.note,
            importNote: existing.importNote,
            reminderEnabled: existing.reminderEnabled,
          },
          newValue: { ...nasiyaUpdate, ...customerUpdate, auditReason: parsed.data.reason ?? parsed.data.note },
          note: parsed.data.reason ?? parsed.data.note,
        },
      })
      return nasiya
    })

    invalidateShopNasiyaMutation(existing.shopId)

    return ok(updated, "Nasiya ma'lumotlari yangilandi")
  } catch (err) {
    logger.error('[PATCH /api/nasiya/[id]]', { event: 'api.route_error', error: err })
    return serverError()
  }
}
