import { convertUzsToUsd, type CurrencyCode } from '@/lib/currency'
import { roundContractMoney } from '@/lib/nasiya-contract'
import type { PaymentBreakdownMethod, PaymentBreakdownPart } from '@/lib/payment-breakdown'

export type ReturnPaymentKind = 'SALE' | 'NASIYA'

export interface ReturnReceiptSource {
  id: string
  kind: ReturnPaymentKind
  paidAt: Date
  paymentMethod: PaymentBreakdownMethod | null
  paymentBreakdown: unknown
  amountUzs: number
  paymentInputAmount: number | null
  paymentExchangeRate: number | null
  appliedContractAmount: number | null
}

export interface ReturnRefundAllocationInput {
  salePaymentId?: string
  nasiyaPaymentId?: string
  sourcePaymentMethod: PaymentBreakdownMethod
  refundMethod: PaymentBreakdownMethod
  contractCurrency: CurrencyCode
  contractAmount: number
  amountUzs: number
}

interface ReceiptBucket {
  source: ReturnReceiptSource
  method: PaymentBreakdownMethod
  contractAmount: number
}

const RETURN_PAYMENT_METHODS: readonly PaymentBreakdownMethod[] = ['CASH', 'CARD', 'TRANSFER', 'OTHER']

function isPaymentBreakdown(value: unknown): value is PaymentBreakdownPart[] {
  return Array.isArray(value) && value.length > 0 && value.every((part) => {
    if (!part || typeof part !== 'object') return false
    const candidate = part as { method?: unknown; amount?: unknown }
    return (
      ['CASH', 'TRANSFER', 'CARD', 'OTHER'].includes(String(candidate.method)) &&
      Number.isFinite(Number(candidate.amount)) &&
      Number(candidate.amount) > 0
    )
  })
}

/**
 * Recover a payment's contract-native applied amount. New rows carry the
 * exact value. Legacy USD rows fall back to their frozen creation/payment
 * rate rather than a later live rate.
 */
export function resolveAppliedContractAmount(
  source: ReturnReceiptSource,
  contractCurrency: CurrencyCode,
  frozenUsdUzsRate: number | null,
): number {
  if (source.appliedContractAmount !== null && Number.isFinite(source.appliedContractAmount)) {
    return roundContractMoney(source.appliedContractAmount, contractCurrency)
  }
  if (contractCurrency === 'UZS') return roundContractMoney(source.amountUzs, 'UZS')
  const legacyRate = source.paymentExchangeRate ?? frozenUsdUzsRate
  if (!legacyRate || legacyRate <= 0) {
    throw new Error("Eski USD to'lovining saqlangan kursi yo'q. Qaytarishdan oldin ma'lumotni tekshiring.")
  }
  return roundContractMoney(convertUzsToUsd(source.amountUzs, legacyRate), 'USD')
}

function receiptBuckets(
  source: ReturnReceiptSource,
  contractCurrency: CurrencyCode,
  frozenUsdUzsRate: number | null,
): ReceiptBucket[] {
  const applied = resolveAppliedContractAmount(source, contractCurrency, frozenUsdUzsRate)
  if (applied <= 0) return []

  const breakdown = source.paymentBreakdown
  if (isPaymentBreakdown(breakdown)) {
    const total = breakdown.reduce((sum, part) => sum + Number(part.amount), 0)
    let allocated = 0
    return breakdown.map((part, index) => {
      const contractAmount = index === breakdown.length - 1
        ? roundContractMoney(applied - allocated, contractCurrency)
        : roundContractMoney(applied * (Number(part.amount) / total), contractCurrency)
      allocated = roundContractMoney(allocated + contractAmount, contractCurrency)
      return { source, method: part.method, contractAmount }
    }).filter((bucket) => bucket.contractAmount > 0)
  }

  if (!source.paymentMethod) return []
  return [{ source, method: source.paymentMethod, contractAmount: applied }]
}

/**
 * Contract-native money that can be refunded through each original receipt
 * method. The return ledger requires a refund to use the same method as the
 * receipts it reverses, so the UI and mutation share this exact projection.
 */
export function returnRefundCapacityByMethod({
  sources,
  contractCurrency,
  frozenUsdUzsRate,
}: {
  sources: ReturnReceiptSource[]
  contractCurrency: CurrencyCode
  frozenUsdUzsRate: number | null
}): Record<PaymentBreakdownMethod, number> {
  const capacities = Object.fromEntries(
    RETURN_PAYMENT_METHODS.map((method) => [method, 0]),
  ) as Record<PaymentBreakdownMethod, number>

  for (const bucket of sources.flatMap((source) => receiptBuckets(source, contractCurrency, frozenUsdUzsRate))) {
    capacities[bucket.method] = roundContractMoney(
      capacities[bucket.method] + bucket.contractAmount,
      contractCurrency,
    )
  }
  return capacities
}

/**
 * Allocate a refund to the newest matching original receipts first. The
 * refund method must match the source method, which keeps cash/card/transfer
 * reconciliation honest. Every returned allocation references one immutable
 * payment row and the final allocation absorbs rounding remainder.
 */
export function allocateReturnRefund({
  sources,
  contractCurrency,
  frozenUsdUzsRate,
  refundMethod,
  refundContractAmount,
  refundAmountUzs,
}: {
  sources: ReturnReceiptSource[]
  contractCurrency: CurrencyCode
  frozenUsdUzsRate: number | null
  refundMethod: PaymentBreakdownMethod
  refundContractAmount: number
  refundAmountUzs: number
}): ReturnRefundAllocationInput[] {
  const target = roundContractMoney(refundContractAmount, contractCurrency)
  if (target <= 0 || refundAmountUzs <= 0) return []

  const buckets = sources
    .slice()
    .sort((left, right) => right.paidAt.getTime() - left.paidAt.getTime())
    .flatMap((source) => receiptBuckets(source, contractCurrency, frozenUsdUzsRate))
    .filter((bucket) => bucket.method === refundMethod)

  const available = roundContractMoney(
    buckets.reduce((sum, bucket) => sum + bucket.contractAmount, 0),
    contractCurrency,
  )
  if (available < target) {
    throw new Error(
      `Tanlangan usul bo'yicha ko'pi bilan ${available.toFixed(contractCurrency === 'USD' ? 2 : 0)} ${contractCurrency} qaytarish mumkin.`,
    )
  }

  const selected: { bucket: ReceiptBucket; contractAmount: number }[] = []
  let contractRemaining = target
  for (const bucket of buckets) {
    if (contractRemaining <= 0) break
    const contractAmount = roundContractMoney(
      Math.min(bucket.contractAmount, contractRemaining),
      contractCurrency,
    )
    if (contractAmount <= 0) continue
    selected.push({ bucket, contractAmount })
    contractRemaining = roundContractMoney(contractRemaining - contractAmount, contractCurrency)
  }
  if (contractRemaining > 0) throw new Error("Qaytarish summasini asl to'lovlarga to'liq bog'lab bo'lmadi.")

  let uzsAllocated = 0
  return selected.map(({ bucket, contractAmount }, index) => {
    const amountUzs = index === selected.length - 1
      ? refundAmountUzs - uzsAllocated
      : Math.max(1, Math.round(refundAmountUzs * (contractAmount / target)))
    uzsAllocated += amountUzs
    return {
      ...(bucket.source.kind === 'SALE'
        ? { salePaymentId: bucket.source.id }
        : { nasiyaPaymentId: bucket.source.id }),
      sourcePaymentMethod: bucket.method,
      refundMethod,
      contractCurrency,
      contractAmount,
      amountUzs,
    }
  })
}
