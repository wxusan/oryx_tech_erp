/**
 * Professional nasiya customer payment-behavior score.
 *
 * A deterministic 0-100 score derived from real schedule/payment data — NOT a
 * simple 3-line rule. See docs/nasiya-payment-scoring.md for the full spec,
 * thresholds, and worked examples.
 *
 * Design notes:
 *   - Pure function, no DB access — callers assemble `schedules` from
 *     NasiyaSchedule rows. Amounts (expectedAmount/paidAmount) should be the
 *     nasiya's own CONTRACT-currency figures (contractExpectedAmount/
 *     contractPaidAmount), not the legacy UZS snapshot — see
 *     docs/currency-accounting-model.md. `contractCurrency` defaults to UZS,
 *     so any caller not yet updated keeps today's exact behavior.
 *   - "Currently overdue" reuses the currency-aware predicate from
 *     nasiya-contract.ts (isContractScheduleOverdue), which is byte-identical
 *     to nasiya-utils.ts's isScheduleOverdue for UZS — so this still agrees
 *     with the dashboard, the list, and the payment route for UZS contracts,
 *     and correctly uses cent-level tolerance for USD ones.
 *   - GRACE_DAYS: a payment made up to this many days AFTER the due date still
 *     counts as on-time (not late). Chosen as 1 day — enough to absorb
 *     same/next-day bank clearing without rewarding real lateness.
 *   - Imported (pre-Oryx) debt never needs special-casing here: an imported
 *     nasiya's `alreadyPaidBeforeImport` is a lump sum that never produces a
 *     NasiyaSchedule row with status PAID + a real paidAt — only genuine
 *     post-import payments do — so it's naturally excluded from history.
 */

import { scheduleEffectiveDueTime, type OverdueScheduleInput } from '@/lib/nasiya-utils'
import { isContractScheduleOverdue, formatDisplayMoneyFromContract } from '@/lib/nasiya-contract'
import { type CurrencyContext, type CurrencyCode } from '@/lib/currency'

/** A grace day is added to the due date before a paid installment counts as late. */
export const GRACE_DAYS = 1

export interface NasiyaScoreScheduleInput extends OverdueScheduleInput {
  /** When the installment was actually paid (null/undefined if still unpaid). */
  paidAt: Date | string | null | undefined
  /** Non-cash settlement is excluded from both overdue debt and paid history. */
  interestWaivedAmount?: number | string | null
}

export type PaymentScoreColor = 'green' | 'yellow' | 'red' | 'gray'
export type PaymentRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN'
export type PaymentScoreLabel = "Ishonchli mijoz" | "Vaqtida to'laydi" | 'Kechiktiradi' | 'Yangi mijoz'

export interface NasiyaPaymentScoreFactors {
  currentOverdueAmount: number
  overdueScheduleCount: number
  paidInstallmentCount: number
  earlyPaymentCount: number
  onTimePaymentCount: number
  latePaymentCount: number
  averageDaysEarlyLate: number
  maxDaysLate: number
  paidRatio: number
  historyConfidence: 'LOW' | 'MEDIUM' | 'HIGH'
}

export interface NasiyaPaymentScore {
  score: number
  label: PaymentScoreLabel
  color: PaymentScoreColor
  riskLevel: PaymentRiskLevel
  reason: string
  factors: NasiyaPaymentScoreFactors
}

function toTime(value: Date | string): number {
  return (value instanceof Date ? value : new Date(value)).getTime()
}

const DEFAULT_CURRENCY: CurrencyContext = { currency: 'UZS', usdUzsRate: null }

function buildHistoryReason(
  paidInstallmentCount: number,
  goodCount: number,
  latePaymentCount: number,
  maxDaysLate: number,
): string {
  if (latePaymentCount > 0) {
    return `${paidInstallmentCount} ta to'lovdan ${latePaymentCount} tasi kechikkan (eng ko'pi ${Math.round(maxDaysLate)} kun)`
  }
  return `${paidInstallmentCount} ta to'lovdan ${goodCount} tasi vaqtida`
}

/**
 * Compute the payment-behavior score for one nasiya from its schedule rows.
 * Deterministic: same input + same `now`/`currency`/`contractCurrency` always
 * yields the same output. `currency` (display) and `contractCurrency` (the
 * amounts' own currency) together only affect the human-readable `reason`
 * string and the currency-aware overdue tolerance — the score/label/color
 * ratios themselves are unit-independent (ratios and day-counts, not
 * absolute-magnitude comparisons). Scoring math must never depend on display
 * currency; only text formatting does.
 */
export function computeNasiyaPaymentScore(
  input: { schedules: NasiyaScoreScheduleInput[] },
  now: Date = new Date(),
  currency: CurrencyContext = DEFAULT_CURRENCY,
  contractCurrency: CurrencyCode = 'UZS',
): NasiyaPaymentScore {
  const schedules = input.schedules
  const cashAdjustedSchedules = schedules.map((schedule) => ({
    ...schedule,
    expectedAmount: Math.max(0, Number(schedule.expectedAmount) - Number(schedule.interestWaivedAmount ?? 0)),
  }))

  // --- 1. Current overdue status (strongest red signal, overrides everything) ---
  const overdueSchedules = cashAdjustedSchedules.filter((s) => isContractScheduleOverdue(s, contractCurrency, now))
  const currentOverdueAmount = overdueSchedules.reduce(
    (sum, s) => sum + Math.max(0, Number(s.expectedAmount) - Number(s.paidAmount)),
    0,
  )
  const overdueScheduleCount = overdueSchedules.length
  const isCurrentlyOverdue = overdueScheduleCount > 0

  // --- 2. Payment timing history (paid installments only, real paidAt) ---
  const paidSchedules = cashAdjustedSchedules.filter((s) => s.status === 'PAID' && s.paidAt != null)
  const paidInstallmentCount = paidSchedules.length

  let earlyPaymentCount = 0
  let onTimePaymentCount = 0
  let latePaymentCount = 0
  let totalDaysEarlyLate = 0
  let maxDaysLate = 0

  for (const schedule of paidSchedules) {
    const dueTime = scheduleEffectiveDueTime(schedule)
    const paidTime = toTime(schedule.paidAt!)
    const daysEarlyLate = (paidTime - dueTime) / 86400000
    totalDaysEarlyLate += daysEarlyLate
    if (daysEarlyLate < 0) {
      earlyPaymentCount++
    } else if (daysEarlyLate <= GRACE_DAYS) {
      onTimePaymentCount++
    } else {
      latePaymentCount++
      maxDaysLate = Math.max(maxDaysLate, daysEarlyLate)
    }
  }

  const averageDaysEarlyLate = paidInstallmentCount > 0 ? totalDaysEarlyLate / paidInstallmentCount : 0

  // --- 3. Paid ratio (informs confidence, not a standalone green signal) ---
  const totalExpected = schedules.reduce((sum, s) => sum + Number(s.expectedAmount), 0)
  const totalPaid = schedules.reduce((sum, s) => sum + Number(s.paidAmount), 0)
  const paidRatio = totalExpected > 0 ? totalPaid / totalExpected : 0

  // --- 4. Confidence from sample size ---
  const historyConfidence: 'LOW' | 'MEDIUM' | 'HIGH' =
    paidInstallmentCount >= 3 ? 'HIGH' : paidInstallmentCount === 2 ? 'MEDIUM' : 'LOW'

  const factors: NasiyaPaymentScoreFactors = {
    currentOverdueAmount,
    overdueScheduleCount,
    paidInstallmentCount,
    earlyPaymentCount,
    onTimePaymentCount,
    latePaymentCount,
    averageDaysEarlyLate: Math.round(averageDaysEarlyLate * 10) / 10,
    maxDaysLate: Math.round(maxDaysLate * 10) / 10,
    paidRatio: Math.round(paidRatio * 1000) / 1000,
    historyConfidence,
  }

  // --- 5. Deterministic 0-100 score (spec 5C) ---
  let score = 70

  if (isCurrentlyOverdue) score -= 35
  score -= Math.min(30, overdueScheduleCount * 10)

  if (paidInstallmentCount > 0) {
    if (averageDaysEarlyLate <= -2) score += 10
    else if (averageDaysEarlyLate > 10) score -= 30
    else if (averageDaysEarlyLate > 5) score -= 20
    else if (averageDaysEarlyLate > 1) score -= 10
    // else: between -1 and 1 -> +0 (on time, no adjustment)

    if (maxDaysLate > 30) score -= 35
    else if (maxDaysLate > 15) score -= 20
    else if (maxDaysLate > 7) score -= 10

    const onTimeRatio = (earlyPaymentCount + onTimePaymentCount) / paidInstallmentCount
    if (onTimeRatio >= 0.8 && paidInstallmentCount >= 3) score += 15
    else if (onTimeRatio >= 0.6 && paidInstallmentCount >= 2) score += 5
    else if (onTimeRatio < 0.5) score -= 10

    if (paidRatio > 0.7 && !isCurrentlyOverdue) score += 5
    else if (paidRatio < 0.2 && latePaymentCount > 0) score -= 5
  }

  score = Math.max(0, Math.min(100, Math.round(score)))

  // --- 6. Label/color/risk (confidence-gated so green is never handed out cheaply) ---
  let color: PaymentScoreColor
  let label: PaymentScoreLabel
  let riskLevel: PaymentRiskLevel
  let reason: string

  const goodCount = earlyPaymentCount + onTimePaymentCount

  if (isCurrentlyOverdue) {
    // Red always overrides green/yellow, regardless of past history.
    color = 'red'
    label = 'Kechiktiradi'
    riskLevel = 'HIGH'
    reason = `Hozir ${formatDisplayMoneyFromContract(currentOverdueAmount, contractCurrency, currency.currency, currency.usdUzsRate)} muddati o'tgan`
  } else if (paidInstallmentCount === 0) {
    color = 'gray'
    label = 'Yangi mijoz'
    riskLevel = 'UNKNOWN'
    reason = "Hali to'lov tarixi yetarli emas"
  } else if (paidInstallmentCount === 1) {
    // A single payment can never be enough confidence for green.
    color = score >= 55 ? 'yellow' : 'red'
    label = color === 'yellow' ? "Vaqtida to'laydi" : 'Kechiktiradi'
    riskLevel = color === 'yellow' ? 'MEDIUM' : 'HIGH'
    reason = buildHistoryReason(paidInstallmentCount, goodCount, latePaymentCount, maxDaysLate)
  } else {
    // 2 payments: green only if both were early/on-time. 3+: normal scoring.
    const canBeGreen =
      score >= 80 && ((paidInstallmentCount === 2 && latePaymentCount === 0) || paidInstallmentCount >= 3)
    if (canBeGreen) {
      color = 'green'
      label = 'Ishonchli mijoz'
      riskLevel = 'LOW'
    } else if (score >= 55) {
      color = 'yellow'
      label = "Vaqtida to'laydi"
      riskLevel = 'MEDIUM'
    } else {
      color = 'red'
      label = 'Kechiktiradi'
      riskLevel = 'HIGH'
    }
    reason = buildHistoryReason(paidInstallmentCount, goodCount, latePaymentCount, maxDaysLate)
  }

  return { score, label, color, riskLevel, reason, factors }
}
