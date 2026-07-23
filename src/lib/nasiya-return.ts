import {
  convertMoneyDtoAtMost,
  createMoneyDto,
  subtractMoneyDto,
  type CurrencyCode,
  type FxQuoteDto,
  type MoneyDto,
} from '@/lib/currency'
import { roundContractMoney } from '@/lib/nasiya-contract'
import {
  resolveAppliedContractAmount,
  type ReturnReceiptSource,
} from '@/lib/return-accounting'
import type { PaymentMethod } from '@/lib/domain-types'

export type NasiyaReturnScheduleStatus =
  | 'PENDING'
  | 'PARTIAL'
  | 'PAID'
  | 'SETTLED'
  | 'OVERDUE'
  | 'DEFERRED'
  | 'CANCELLED'

const OPEN_RETURN_SCHEDULE_STATUSES = new Set<NasiyaReturnScheduleStatus>([
  'PENDING',
  'PARTIAL',
  'OVERDUE',
  'DEFERRED',
])

/** Mirrors the transaction's schedule projection for immediate post-return UI. */
export function nasiyaScheduleStatusAfterReturn(
  status: NasiyaReturnScheduleStatus,
): NasiyaReturnScheduleStatus {
  return OPEN_RETURN_SCHEDULE_STATUSES.has(status) ? 'CANCELLED' : status
}

export interface NasiyaReturnContractQuote {
  eligible: boolean
  ineligibilityReason: string | null
  contractCurrency: CurrencyCode
  receipts: MoneyDto
  defaultRefund: MoneyDto
  defaultRetained: MoneyDto
  maxRefund: MoneyDto
  cancelledDebt: MoneyDto
  receiptEvidenceVerified: boolean
}

/**
 * Browser-facing quote. Every editable/visible amount uses exactly the
 * shop-selected display currency, while the two contract-native expectations
 * remain hidden concurrency guards for the mutation.
 */
export interface NasiyaReturnQuoteDto {
  eligible: boolean
  ineligibilityReason: string | null
  contractCurrency: CurrencyCode
  displayCurrency: CurrencyCode
  fxQuote: FxQuoteDto | null
  requiresFxForRefund: boolean
  receipts: MoneyDto
  defaultRefund: MoneyDto
  defaultRetained: MoneyDto
  maxRefund: MoneyDto
  cancelledDebt: MoneyDto
  contractReceipts: MoneyDto
  contractCancelledDebt: MoneyDto
  receiptEvidenceVerified: boolean
}

export interface NasiyaReturnRecordDto {
  id: string
  returnedAt: string
  contractCurrency: CurrencyCode
  receipts: MoneyDto
  refundInput: MoneyDto
  refund: MoneyDto
  retained: MoneyDto
  cancelledDebt: MoneyDto
  refundMethod: PaymentMethod | null
  reason: string
  actorId: string
}

export interface NasiyaReturnMutationResult {
  duplicate: boolean
  nasiyaId: string
  deviceId: string
  deviceStatus: 'IN_STOCK'
  status: 'RETURNED'
  return: NasiyaReturnRecordDto
}

/** Calendar/status refresh lag is operational, not missing money evidence. */
export function nasiyaReturnLedgerHasBlockingReasons(reasons: readonly string[]) {
  return reasons.some((reason) => !(
    reason.endsWith('status differs from schedule-derived status') ||
    reason === 'parent status differs from schedule-derived status'
  ))
}

/**
 * Build the return modal's server-owned quote from immutable receipt rows.
 * Unverifiable historic evidence is surfaced as an explicit block; it is
 * never replaced with an inferred refund or retained-profit amount.
 */
export function calculateNasiyaReturnQuote(input: {
  contractCurrency: CurrencyCode
  contractDownPayment: number
  cancelledDebt: number
  contractExchangeRateAtCreation: number | null
  accountingReconstructionStatus: 'PENDING' | 'COMPLETE' | 'PARTIAL' | 'UNRECONSTRUCTABLE'
  resolutionState: 'ACTIVE' | 'ARCHIVED' | 'WRITTEN_OFF'
  deviceStatus: string
  sources: ReturnReceiptSource[]
}): NasiyaReturnContractQuote {
  const zero = createMoneyDto(input.contractCurrency, 0)
  const blocked = (reason: string): NasiyaReturnContractQuote => ({
    eligible: false,
    ineligibilityReason: reason,
    contractCurrency: input.contractCurrency,
    receipts: zero,
    defaultRefund: zero,
    defaultRetained: zero,
    maxRefund: zero,
    cancelledDebt: createMoneyDto(input.contractCurrency, input.cancelledDebt),
    receiptEvidenceVerified: false,
  })

  if (input.resolutionState !== 'ACTIVE') {
    return blocked("Arxivlangan nasiya avval qayta ochilishi kerak")
  }
  if (input.deviceStatus !== 'SOLD_NASIYA') {
    return blocked("Qurilma nasiyada sotilgan holatda emas")
  }
  if (input.accountingReconstructionStatus !== 'COMPLETE') {
    return blocked("Bu eski nasiya bo‘yicha to‘lov dalillari to‘liq tasdiqlanmagan. Qaytarishdan oldin moliyaviy yozuvlarni tekshiring.")
  }

  try {
    const receipts = roundContractMoney(
      input.sources.reduce((sum, source) => sum + resolveAppliedContractAmount(
        source,
        input.contractCurrency,
        input.contractExchangeRateAtCreation,
      ), 0),
      input.contractCurrency,
    )
    const downPayment = roundContractMoney(input.contractDownPayment, input.contractCurrency)
    if (downPayment > receipts) {
      return blocked("Boshlang‘ich to‘lovni tasdiqlovchi tushum yozuvi yetarli emas. Qaytarishdan oldin moliyaviy yozuvlarni tekshiring.")
    }
    const defaultRefund = Math.min(downPayment, receipts)
    return {
      eligible: true,
      ineligibilityReason: null,
      contractCurrency: input.contractCurrency,
      receipts: createMoneyDto(input.contractCurrency, receipts),
      defaultRefund: createMoneyDto(input.contractCurrency, defaultRefund),
      defaultRetained: createMoneyDto(input.contractCurrency, receipts - defaultRefund),
      maxRefund: createMoneyDto(input.contractCurrency, receipts),
      cancelledDebt: createMoneyDto(input.contractCurrency, input.cancelledDebt),
      receiptEvidenceVerified: true,
    }
  } catch (error) {
    return blocked(error instanceof Error
      ? error.message
      : "To‘lov dalillarini tasdiqlab bo‘lmadi")
  }
}

/**
 * Convert a verified native quote into one shop-currency quote. Limits use
 * floor-safe conversion so the displayed maximum can be submitted without a
 * one-minor-unit round-trip overflow.
 */
export function presentNasiyaReturnQuote(
  quote: NasiyaReturnContractQuote,
  displayCurrency: CurrencyCode,
  fxQuote: FxQuoteDto | null | undefined,
): NasiyaReturnQuoteDto {
  const zero = createMoneyDto(displayCurrency, 0)
  const receipts = convertMoneyDtoAtMost(quote.receipts, displayCurrency, fxQuote)
  const defaultRefund = convertMoneyDtoAtMost(quote.defaultRefund, displayCurrency, fxQuote)
  const cancelledDebt = convertMoneyDtoAtMost(quote.cancelledDebt, displayCurrency, fxQuote)
  const conversionUnavailable = !receipts || !defaultRefund || !cancelledDebt
  const visibleReceipts = receipts ?? zero
  const visibleDefaultRefund = defaultRefund ?? zero
  const visibleCancelledDebt = cancelledDebt ?? zero

  return {
    eligible: quote.eligible && !conversionUnavailable,
    ineligibilityReason: quote.ineligibilityReason ?? (
      conversionUnavailable
        ? "Do‘kon valyutasida hisoblash uchun USD/UZS kursi mavjud emas"
        : null
    ),
    contractCurrency: quote.contractCurrency,
    displayCurrency,
    fxQuote: fxQuote ?? null,
    requiresFxForRefund: quote.contractCurrency === 'USD' || displayCurrency === 'USD',
    receipts: visibleReceipts,
    defaultRefund: visibleDefaultRefund,
    defaultRetained: subtractMoneyDto(visibleReceipts, visibleDefaultRefund),
    maxRefund: visibleReceipts,
    cancelledDebt: visibleCancelledDebt,
    contractReceipts: quote.receipts,
    contractCancelledDebt: quote.cancelledDebt,
    receiptEvidenceVerified: quote.receiptEvidenceVerified,
  }
}
