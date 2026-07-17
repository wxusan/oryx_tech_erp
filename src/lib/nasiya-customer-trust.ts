/**
 * Item 12 — nasiya client trust/rating system.
 *
 * A shop-scoped, explainable trust tier for a customer, aggregated across
 * ALL of their nasiyas (not a single deal — see nasiya-payment-score.ts for
 * the per-nasiya score this builds on). Deliberately NOT called a "credit
 * score": it only reflects this shop's own nasiya history with the
 * customer, and every tier comes with plain-language `reasons`.
 *
 * Pure function, no DB access — callers assemble `nasiyas` from Nasiya rows
 * (with their schedules) for one customer within one shop.
 */

import { computeNasiyaPaymentScore, type NasiyaScoreScheduleInput } from '@/lib/nasiya-payment-score'
import { type CurrencyCode } from '@/lib/currency'

export type TrustTier = 'NEW' | 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH'

export const TRUST_TIERS: TrustTier[] = ['NEW', 'LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH']

/** Exact Uzbek labels as specified for this feature — never "kredit reytingi" / "credit score". */
export const TRUST_TIER_LABELS: Record<TrustTier, string> = {
  NEW: 'Yangi mijoz',
  LOW: 'Past',
  MEDIUM: 'O‘rtacha',
  HIGH: 'Yuqori',
  VERY_HIGH: 'Juda yuqori',
}

export type TrustColor = 'gray' | 'red' | 'yellow' | 'green' | 'emerald'

export const TRUST_TIER_COLORS: Record<TrustTier, TrustColor> = {
  NEW: 'gray',
  LOW: 'red',
  MEDIUM: 'yellow',
  HIGH: 'green',
  VERY_HIGH: 'emerald',
}

export interface CustomerNasiyaInput {
  status: 'ACTIVE' | 'COMPLETED' | 'OVERDUE' | 'CANCELLED'
  resolutionState?: 'ACTIVE' | 'ARCHIVED' | 'WRITTEN_OFF'
  contractCurrency: CurrencyCode
  schedules: NasiyaScoreScheduleInput[]
}

export interface CustomerTrustFactors {
  totalNasiyaCount: number
  completedNasiyaCount: number
  activeNasiyaCount: number
  cancelledNasiyaCount: number
  paidInstallmentCount: number
  onTimeRatio: number | null
  lateInstallmentCount: number
  maxDaysLate: number
  currentOverdueScheduleCount: number
  hasCurrentOverdue: boolean
}

export interface CustomerTrustRating {
  tier: TrustTier
  label: string
  color: TrustColor
  reasons: string[]
  factors: CustomerTrustFactors
  isOverridden: boolean
}

/**
 * Aggregate a customer's full nasiya history into one explainable trust
 * tier. `adminOverride`, when set, wins over the computed tier but the
 * computed factors/reasons are still returned so the override is never
 * opaque.
 */
export function computeCustomerTrustRating(
  nasiyas: CustomerNasiyaInput[],
  now: Date = new Date(),
  adminOverride?: TrustTier | null,
): CustomerTrustRating {
  const totalNasiyaCount = nasiyas.length
  const completedNasiyaCount = nasiyas.filter((n) => n.status === 'COMPLETED').length
  const activeNasiyaCount = nasiyas.filter(
    (n) => (n.resolutionState ?? 'ACTIVE') === 'ACTIVE' && (n.status === 'ACTIVE' || n.status === 'OVERDUE'),
  ).length
  const cancelledNasiyaCount = nasiyas.filter((n) => n.status === 'CANCELLED').length

  let paidInstallmentCount = 0
  let onTimeCount = 0
  let lateInstallmentCount = 0
  let maxDaysLate = 0
  let currentOverdueScheduleCount = 0

  for (const nasiya of nasiyas) {
    // A cancelled deal's schedule rows carry no meaningful payment-timing
    // signal (the deal was voided, not paid off or defaulted on).
    if (nasiya.status === 'CANCELLED') continue
    // A non-active contract stops contributing new collection/overdue pressure,
    // while any already-paid instalment remains valid historical evidence.
    const resolutionState = nasiya.resolutionState ?? 'ACTIVE'
    const scoreSchedules = resolutionState !== 'ACTIVE'
      ? nasiya.schedules.filter((schedule) => schedule.status === 'PAID')
      : nasiya.schedules
    const score = computeNasiyaPaymentScore({ schedules: scoreSchedules }, now, undefined, nasiya.contractCurrency)
    paidInstallmentCount += score.factors.paidInstallmentCount
    onTimeCount += score.factors.earlyPaymentCount + score.factors.onTimePaymentCount
    lateInstallmentCount += score.factors.latePaymentCount
    maxDaysLate = Math.max(maxDaysLate, score.factors.maxDaysLate)
    currentOverdueScheduleCount += score.factors.overdueScheduleCount
  }

  const onTimeRatio = paidInstallmentCount > 0 ? onTimeCount / paidInstallmentCount : null
  const hasCurrentOverdue = currentOverdueScheduleCount > 0

  const factors: CustomerTrustFactors = {
    totalNasiyaCount,
    completedNasiyaCount,
    activeNasiyaCount,
    cancelledNasiyaCount,
    paidInstallmentCount,
    onTimeRatio: onTimeRatio != null ? Math.round(onTimeRatio * 1000) / 1000 : null,
    lateInstallmentCount,
    maxDaysLate: Math.round(maxDaysLate * 10) / 10,
    currentOverdueScheduleCount,
    hasCurrentOverdue,
  }

  return computeCustomerTrustRatingFromFactors(factors, adminOverride)
}

/**
 * Produce the exact same rating from a bounded aggregate projection. List
 * routes use this form so a mature customer's entire contract/schedule
 * history does not have to cross the database boundary just to render a badge.
 */
export function computeCustomerTrustRatingFromFactors(
  factors: CustomerTrustFactors,
  adminOverride?: TrustTier | null,
): CustomerTrustRating {
  const {
    totalNasiyaCount,
    completedNasiyaCount,
    cancelledNasiyaCount,
    paidInstallmentCount,
    onTimeRatio,
    lateInstallmentCount,
    maxDaysLate,
    currentOverdueScheduleCount,
    hasCurrentOverdue,
  } = factors

  const reasons: string[] = []
  let tier: TrustTier

  if (totalNasiyaCount === 0) {
    tier = 'NEW'
    reasons.push("Hali birorta ham nasiya tarixi yo'q")
  } else {
    let score = 50
    score += Math.min(30, completedNasiyaCount * 10)
    if (onTimeRatio != null) {
      if (onTimeRatio >= 0.9) score += 20
      else if (onTimeRatio >= 0.75) score += 10
      else if (onTimeRatio < 0.5) score -= 20
      else score -= 5
    }
    score -= Math.min(25, lateInstallmentCount * 5)
    if (maxDaysLate > 30) score -= 25
    else if (maxDaysLate > 14) score -= 15
    else if (maxDaysLate > 7) score -= 5
    if (hasCurrentOverdue) score -= 30
    score -= Math.min(20, cancelledNasiyaCount * 10)
    score = Math.max(0, Math.min(100, Math.round(score)))

    // A single completed deal or a small handful of paid installments isn't
    // enough confidence for HIGH/VERY_HIGH — mirrors the confidence gating
    // already used by the per-nasiya score.
    const hasEnoughHistory = paidInstallmentCount >= 3 || completedNasiyaCount >= 1

    if (hasCurrentOverdue) {
      tier = 'LOW'
      reasons.push(`Hozirda ${currentOverdueScheduleCount} ta muddati o'tgan to'lov bor`)
    } else if (!hasEnoughHistory) {
      tier = score >= 60 ? 'MEDIUM' : 'LOW'
      reasons.push("To'lov tarixi hali kam, ishonch darajasi vaqtinchalik")
    } else if (score >= 85 && lateInstallmentCount === 0 && cancelledNasiyaCount === 0) {
      tier = 'VERY_HIGH'
      reasons.push(`${completedNasiyaCount} ta nasiya to'liq va vaqtida yopilgan`)
    } else if (score >= 65) {
      tier = 'HIGH'
      reasons.push(`${completedNasiyaCount} ta nasiya yopilgan, to'lovlar asosan vaqtida`)
    } else if (score >= 40) {
      tier = 'MEDIUM'
      reasons.push("To'lovlarda ba'zan kechikishlar bo'lgan")
    } else {
      tier = 'LOW'
      reasons.push("To'lov tarixida ko'p kechikishlar bor")
    }

    if (lateInstallmentCount > 0) {
      reasons.push(`${lateInstallmentCount} ta to'lov kechikkan (eng ko'pi ${Math.round(maxDaysLate)} kun)`)
    }
    if (cancelledNasiyaCount > 0) {
      reasons.push(`${cancelledNasiyaCount} ta nasiya bekor qilingan`)
    }
  }

  const isOverridden = adminOverride != null
  const finalTier = adminOverride ?? tier
  if (isOverridden) {
    reasons.push("Admin tomonidan qo'lda belgilangan")
  }

  return {
    tier: finalTier,
    label: TRUST_TIER_LABELS[finalTier],
    color: TRUST_TIER_COLORS[finalTier],
    reasons,
    factors,
    isOverridden,
  }
}

export function isValidTrustTier(value: unknown): value is TrustTier {
  return typeof value === 'string' && (TRUST_TIERS as string[]).includes(value)
}
