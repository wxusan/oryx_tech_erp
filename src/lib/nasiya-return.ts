import {
  createMoneyDto,
  type CurrencyCode,
  type MoneyDto,
} from '@/lib/currency'
import { roundContractMoney } from '@/lib/nasiya-contract'
import {
  resolveAppliedContractAmount,
  returnRefundCapacityByMethod,
  type ReturnReceiptSource,
} from '@/lib/return-accounting'
import type { PaymentMethod } from '@/lib/domain-types'

const PAYMENT_METHODS: readonly PaymentMethod[] = ['CASH', 'CARD', 'TRANSFER', 'OTHER']

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

export interface NasiyaReturnMethodCapacityDto {
  method: PaymentMethod
  available: MoneyDto
}

export interface NasiyaReturnQuoteDto {
  eligible: boolean
  ineligibilityReason: string | null
  contractCurrency: CurrencyCode
  receipts: MoneyDto
  defaultRefund: MoneyDto
  defaultRetained: MoneyDto
  maxRefund: MoneyDto
  cancelledDebt: MoneyDto
  methodCapacities: NasiyaReturnMethodCapacityDto[]
  defaultRefundMethod: PaymentMethod | null
  receiptEvidenceVerified: boolean
}

export interface NasiyaReturnRecordDto {
  id: string
  returnedAt: string
  contractCurrency: CurrencyCode
  receipts: MoneyDto
  refund: MoneyDto
  retained: MoneyDto
  cancelledDebt: MoneyDto
  refundUzs: MoneyDto
  retainedUzs: MoneyDto
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

function preferredMethod(
  sources: ReturnReceiptSource[],
  capacities: Record<PaymentMethod, number>,
  defaultRefund: number,
): PaymentMethod | null {
  if (defaultRefund <= 0) return null
  const oldest = sources.slice().sort((left, right) => left.paidAt.getTime() - right.paidAt.getTime())[0]
  const firstBreakdownMethod = Array.isArray(oldest?.paymentBreakdown)
    ? (oldest.paymentBreakdown.find((part): part is { method: PaymentMethod } => (
        Boolean(part) && typeof part === 'object' && PAYMENT_METHODS.includes((part as { method?: PaymentMethod }).method as PaymentMethod)
      ))?.method ?? null)
    : null
  const oldestMethod = oldest?.paymentMethod ?? firstBreakdownMethod
  if (oldestMethod && capacities[oldestMethod] >= defaultRefund) return oldestMethod
  return PAYMENT_METHODS.find((method) => capacities[method] >= defaultRefund)
    ?? PAYMENT_METHODS.reduce<PaymentMethod | null>((best, method) => (
      best === null || capacities[method] > capacities[best] ? method : best
    ), null)
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
}): NasiyaReturnQuoteDto {
  const zero = createMoneyDto(input.contractCurrency, 0)
  const blocked = (reason: string): NasiyaReturnQuoteDto => ({
    eligible: false,
    ineligibilityReason: reason,
    contractCurrency: input.contractCurrency,
    receipts: zero,
    defaultRefund: zero,
    defaultRetained: zero,
    maxRefund: zero,
    cancelledDebt: createMoneyDto(input.contractCurrency, input.cancelledDebt),
    methodCapacities: PAYMENT_METHODS.map((method) => ({ method, available: zero })),
    defaultRefundMethod: null,
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
    const capacities = returnRefundCapacityByMethod({
      sources: input.sources,
      contractCurrency: input.contractCurrency,
      frozenUsdUzsRate: input.contractExchangeRateAtCreation,
    })
    return {
      eligible: true,
      ineligibilityReason: null,
      contractCurrency: input.contractCurrency,
      receipts: createMoneyDto(input.contractCurrency, receipts),
      defaultRefund: createMoneyDto(input.contractCurrency, defaultRefund),
      defaultRetained: createMoneyDto(input.contractCurrency, receipts - defaultRefund),
      maxRefund: createMoneyDto(input.contractCurrency, receipts),
      cancelledDebt: createMoneyDto(input.contractCurrency, input.cancelledDebt),
      methodCapacities: PAYMENT_METHODS.map((method) => ({
        method,
        available: createMoneyDto(input.contractCurrency, capacities[method]),
      })),
      defaultRefundMethod: preferredMethod(input.sources, capacities, defaultRefund),
      receiptEvidenceVerified: true,
    }
  } catch (error) {
    return blocked(error instanceof Error
      ? error.message
      : "To‘lov dalillarini tasdiqlab bo‘lmadi")
  }
}
