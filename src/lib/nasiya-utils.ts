/**
 * Nasiya (instalment plan) calculation utilities for Oryx Tech ERP.
 */

import { addMonths } from 'date-fns'
import type { PaymentScheduleItem, NasiyaSchedule } from '@/types'
import { NasiyaScheduleStatus } from '@/types'
import type { CurrencyCode } from '@/lib/currency'
import { isBeforeTashkentToday } from '@/lib/timezone'

export const MAX_NASIYA_INTEREST_PERCENT = 300

export interface NasiyaAmountCalculation {
  totalAmount: number
  downPayment: number
  baseRemainingAmount: number
  interestPercent: number
  interestAmount: number
  finalNasiyaAmount: number
  monthlyPayment: number
}

/**
 * Round a money value to the smallest unit its currency actually supports —
 * whole so'm for UZS (unchanged default, matches every existing UZS caller),
 * cents for USD. Threading `currency` through here (rather than always
 * rounding to a whole number) is what makes `calculateNasiyaAmounts`/
 * `generatePaymentSchedule` safe to reuse for a USD-native contract ledger.
 */
function roundMoney(value: number, currency: CurrencyCode = 'UZS'): number {
  return currency === 'USD' ? Math.round(value * 100) / 100 : Math.round(value)
}

/**
 * Calculate the debt created by a nasiya sale.
 *
 * totalAmount remains the original device sale price. Interest is applied only
 * to the amount left after the down payment. `currency` defaults to UZS
 * (unchanged behavior for the legacy ledger); pass 'USD' to compute the same
 * shape in native USD contract terms (cent-rounded instead of whole-number).
 */
export function calculateNasiyaAmounts(params: {
  totalAmount: number
  downPayment: number
  months: number
  interestPercent?: number
  currency?: CurrencyCode
}): NasiyaAmountCalculation {
  const currency = params.currency ?? 'UZS'
  const totalAmount = roundMoney(params.totalAmount, currency)
  const downPayment = roundMoney(params.downPayment, currency)
  const interestPercent = params.interestPercent ?? 0

  if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
    throw new Error("Jami narx musbat son bo'lishi kerak")
  }
  if (!Number.isFinite(downPayment) || downPayment < 0) {
    throw new Error("Boshlang'ich to'lov manfiy bo'lmasligi kerak")
  }
  if (downPayment > totalAmount) {
    throw new Error("Boshlang'ich to'lov jami narxdan oshmasligi kerak")
  }
  if (!Number.isInteger(params.months) || params.months < 1 || params.months > 24) {
    throw new Error("Oy soni 1 dan 24 gacha bo'lishi kerak")
  }
  if (!Number.isInteger(interestPercent) || interestPercent < 0 || interestPercent > MAX_NASIYA_INTEREST_PERCENT) {
    throw new Error(`Nasiya foizi 0 dan ${MAX_NASIYA_INTEREST_PERCENT} gacha butun son bo'lishi kerak`)
  }

  const baseRemainingAmount = totalAmount - downPayment
  const interestAmount = roundMoney((baseRemainingAmount * interestPercent) / 100, currency)
  // Re-round after adding two already-rounded values — for USD (cent
  // precision), plain float addition can leave sub-cent binary representation
  // dust (e.g. 849.5 + 127.43 = 976.9300000000001), which whole-number UZS
  // rounding always happened to absorb but 2-decimal rounding does not.
  const finalNasiyaAmount = roundMoney(baseRemainingAmount + interestAmount, currency)

  if (finalNasiyaAmount <= 0) {
    throw new Error("Nasiya uchun qarz summasi 0 dan katta bo'lishi kerak")
  }

  return {
    totalAmount,
    downPayment,
    baseRemainingAmount,
    interestPercent,
    interestAmount,
    finalNasiyaAmount,
    monthlyPayment: roundMoney(finalNasiyaAmount / params.months, currency),
  }
}

/**
 * The reverse of `calculateNasiyaAmounts` — item 6: when the shop admin
 * manually types a monthly payment instead of an interest percent, the
 * interest must adapt to match, not silently stay at whatever the last
 * interestPercent-driven calculation produced.
 *
 *   finalNasiyaAmount = monthlyPayment * months
 *   interestAmount    = finalNasiyaAmount - baseRemainingAmount
 *   interestPercent   = interestAmount / baseRemainingAmount * 100 (rounded
 *                       to a whole percent for display only — the exact
 *                       finalNasiyaAmount/monthlyPayment above are what
 *                       actually gets stored, never re-derived from the
 *                       rounded percent)
 *
 * Negative interest (monthlyPayment too low to cover the base debt) is
 * rejected, same as calculateNasiyaAmounts rejects an interest percent
 * outside [0, MAX_NASIYA_INTEREST_PERCENT].
 */
export function calculateNasiyaAmountsFromMonthlyPayment(params: {
  totalAmount: number
  downPayment: number
  months: number
  monthlyPayment: number
  currency?: CurrencyCode
}): NasiyaAmountCalculation {
  const currency = params.currency ?? 'UZS'
  const totalAmount = roundMoney(params.totalAmount, currency)
  const downPayment = roundMoney(params.downPayment, currency)
  const monthlyPayment = roundMoney(params.monthlyPayment, currency)

  if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
    throw new Error("Jami narx musbat son bo'lishi kerak")
  }
  if (!Number.isFinite(downPayment) || downPayment < 0) {
    throw new Error("Boshlang'ich to'lov manfiy bo'lmasligi kerak")
  }
  if (downPayment > totalAmount) {
    throw new Error("Boshlang'ich to'lov jami narxdan oshmasligi kerak")
  }
  if (!Number.isInteger(params.months) || params.months < 1 || params.months > 24) {
    throw new Error("Oy soni 1 dan 24 gacha bo'lishi kerak")
  }
  if (!Number.isFinite(monthlyPayment) || monthlyPayment <= 0) {
    throw new Error("Oylik to'lov musbat son bo'lishi kerak")
  }

  const baseRemainingAmount = totalAmount - downPayment
  const finalNasiyaAmount = roundMoney(monthlyPayment * params.months, currency)

  if (finalNasiyaAmount < baseRemainingAmount) {
    throw new Error("Oylik to'lov asosiy qarzni to'liq qoplashi kerak (foiz manfiy bo'lishi mumkin emas)")
  }

  const interestAmount = roundMoney(finalNasiyaAmount - baseRemainingAmount, currency)
  const interestPercent = baseRemainingAmount > 0 ? Math.round((interestAmount / baseRemainingAmount) * 100) : 0

  if (interestPercent > MAX_NASIYA_INTEREST_PERCENT) {
    throw new Error(`Nasiya foizi 0 dan ${MAX_NASIYA_INTEREST_PERCENT} gacha bo'lishi kerak`)
  }

  return {
    totalAmount,
    downPayment,
    baseRemainingAmount,
    interestPercent,
    interestAmount,
    finalNasiyaAmount,
    monthlyPayment,
  }
}

/**
 * Generate a monthly payment schedule for a nasiya plan.
 *
 * @param startDate     - The first payment's start date (payments due from month 1 onward)
 * @param months        - Total number of monthly instalments
 * @param remainingAmount - Total amount to distribute across all instalments
 * @param currency      - Defaults to UZS (unchanged whole-so'm behavior); pass
 *   'USD' to split in cent-precise units instead of whole numbers.
 * @returns Array of PaymentScheduleItem, one per month
 */
export function generatePaymentSchedule(
  startDate: Date,
  months: number,
  remainingAmount: number,
  currency: CurrencyCode = 'UZS',
): PaymentScheduleItem[] {
  const schedule: PaymentScheduleItem[] = []
  // UZS has no fractional subunit in practice (whole so'm); USD needs cents —
  // do the floor/remainder split in the currency's smallest unit so the split
  // is exact either way, then convert back.
  const unitsPerAmount = currency === 'USD' ? 100 : 1
  const roundedTotalUnits = Math.round(remainingAmount * unitsPerAmount)
  const baseAmountUnits = Math.floor(roundedTotalUnits / months)
  const remainderUnits = roundedTotalUnits - baseAmountUnits * months

  for (let i = 1; i <= months; i++) {
    const amountUnits = i === months ? baseAmountUnits + remainderUnits : baseAmountUnits
    schedule.push({
      monthNumber: i,
      dueDate: addMonths(startDate, i),
      expectedAmount: amountUnits / unitsPerAmount,
    })
  }

  return schedule
}

/**
 * Generate the FUTURE payment schedule for an imported (pre-Oryx) nasiya.
 *
 * Unlike `generatePaymentSchedule` (which splits a total evenly over a fixed
 * month count), an imported nasiya has a fixed `monthlyPayment` and only its
 * remaining debt to cover, so:
 *   - count = ceil(remainingDebt / monthlyPayment)
 *   - every schedule = monthlyPayment, EXCEPT the last, which absorbs the
 *     remainder so the schedule sums EXACTLY to remainingDebt
 *   - due dates start at `nextPaymentDate` and step one month each
 *   - all schedules are unpaid (paidAmount 0) — no historical paid months
 *
 * @param nextPaymentDate - due date of the first future instalment
 * @param remainingDebt   - debt still owed at import (must be > 0)
 * @param monthlyPayment  - agreed monthly instalment (must be > 0)
 * @param currency        - defaults to UZS (unchanged whole-so'm behavior);
 *   pass 'USD' to round in cent-precise units instead of whole numbers.
 * @param monthCountOverride - force this many instalments instead of deriving
 *   count from ceil(remainingDebt / monthlyPayment). Used to keep a nasiya's
 *   legacy-UZS schedule and native-contract-currency schedule mirrors at the
 *   exact same length/due-dates when their independently-rounded ratios
 *   would otherwise occasionally disagree by one row (see
 *   docs/currency-accounting-model.md).
 */
export function generateImportSchedule(
  nextPaymentDate: Date,
  remainingDebt: number,
  monthlyPayment: number,
  currency: CurrencyCode = 'UZS',
  monthCountOverride?: number,
): PaymentScheduleItem[] {
  const unitsPerAmount = currency === 'USD' ? 100 : 1
  const total = Math.round(remainingDebt * unitsPerAmount)
  const monthly = Math.round(monthlyPayment * unitsPerAmount)
  if (!Number.isFinite(total) || total <= 0) {
    throw new Error("Qolgan qarz 0 dan katta bo'lishi kerak")
  }
  if (!Number.isFinite(monthly) || monthly <= 0) {
    throw new Error("Oylik to'lov 0 dan katta bo'lishi kerak")
  }

  const count = monthCountOverride ?? Math.ceil(total / monthly)
  if (!Number.isInteger(count) || count <= 0 || count > total) {
    throw new Error("To'lov jadvalini musbat minor birliklarda taqsimlab bo'lmaydi")
  }
  const schedule: PaymentScheduleItem[] = []
  let allocated = 0
  for (let i = 1; i <= count; i++) {
    const isLast = i === count
    const rowsAfter = count - i
    const maximumWithoutStarvingLaterRows = total - allocated - rowsAfter
    const expectedAmountUnits = isLast ? total - allocated : Math.min(monthly, maximumWithoutStarvingLaterRows)
    if (expectedAmountUnits <= 0) {
      throw new Error("To'lov jadvalida nol yoki manfiy qator bo'lishi mumkin emas")
    }
    allocated += expectedAmountUnits
    schedule.push({
      monthNumber: i,
      dueDate: addMonths(nextPaymentDate, i - 1),
      expectedAmount: expectedAmountUnits / unitsPerAmount,
    })
  }
  return schedule
}

/**
 * Calculate the remaining unpaid amount for a nasiya plan.
 *
 * @param total - The total amount owed (after downPayment has been subtracted)
 * @param paid  - The total amount already paid
 * @returns Remaining amount (always >= 0)
 */
export function calculateRemaining(total: number, paid: number): number {
  const remaining = total - paid
  return remaining > 0 ? remaining : 0
}

/**
 * Statuses that still have an outstanding balance (i.e. not fully paid).
 * A row in any of these states still counts towards "next payment" and can be overdue.
 */
const UNPAID_STATUSES: NasiyaScheduleStatus[] = [
  NasiyaScheduleStatus.PENDING,
  NasiyaScheduleStatus.PARTIAL,
  NasiyaScheduleStatus.OVERDUE,
  NasiyaScheduleStatus.DEFERRED,
]

/**
 * Check whether a nasiya plan has any overdue unpaid schedules.
 * A schedule counts as overdue if:
 *   - Its status is already OVERDUE (flipped by cron), or
 *   - It is otherwise unpaid (PENDING / PARTIAL / DEFERRED) and its dueDate is in the past
 *
 * @param schedules - All NasiyaSchedule rows for the nasiya plan
 * @returns true if at least one schedule is overdue
 */
export function isOverdue(schedules: NasiyaSchedule[]): boolean {
  const now = new Date()
  return schedules.some(
    (s) =>
      UNPAID_STATUSES.includes(s.status) &&
      (s.status === NasiyaScheduleStatus.OVERDUE || isBeforeTashkentToday(s.delayedUntil ?? s.dueDate, now)),
  )
}

/**
 * Get the next unpaid schedule for a nasiya plan.
 * Returns the earliest unpaid schedule by dueDate — including rows that have
 * already been flipped to OVERDUE or DEFERRED by cron — so overdue nasiyas
 * still surface a next-payment date.
 *
 * @param schedules - All NasiyaSchedule rows for the nasiya plan
 * @returns The next NasiyaSchedule due, or null if all are paid/cancelled
 */
export function getNextPayment(schedules: NasiyaSchedule[]): NasiyaSchedule | null {
  const pending = schedules
    .filter((s) => UNPAID_STATUSES.includes(s.status))
    .sort((a, b) => {
      const leftDue = a.delayedUntil ?? a.dueDate
      const rightDue = b.delayedUntil ?? b.dueDate
      return leftDue.getTime() - rightDue.getTime()
    })

  return pending[0] ?? null
}

// ---------------------------------------------------------------------------
// Canonical overdue derivation
//
// ONE definition of "overdue" shared by the dashboard (shop-stats),
// the nasiyalar list loader, the list/detail UI and the payment route so all
// surfaces agree. A schedule is overdue when it still owes money and its
// effective due date is in the past. This mirrors, field-for-field, the
// predicate already used by shop-stats.ts (overdueSchedules) and the payment
// route (hasOverdue): `outstanding > 0 && (delayedUntil ?? dueDate) < now`,
// using the instant `now` — NOT a start-of-day boundary — so the list matches
// the dashboard exactly.
// ---------------------------------------------------------------------------

/** Schedule statuses that still carry an outstanding balance. */
const UNPAID_SCHEDULE_STATUS_SET = new Set(['PENDING', 'PARTIAL', 'OVERDUE', 'DEFERRED'])

/** Display status for a whole nasiya contract (mirrors NasiyaStatus enum). */
export type NasiyaDisplayStatus = 'ACTIVE' | 'OVERDUE' | 'COMPLETED' | 'CANCELLED'

/**
 * Minimal schedule shape the overdue helpers read. Dates accept either a Date
 * (server / Prisma) or an ISO string (client / serialized), so the same helper
 * works on both sides of the RSC boundary.
 */
export interface OverdueScheduleInput {
  status: string
  dueDate: Date | string
  delayedUntil: Date | string | null
  expectedAmount: number
  paidAmount: number
}

export interface NasiyaOverdueDerivation {
  isOverdue: boolean
  overdueAmount: number
  overdueCount: number
  nextPaymentDate: Date | null
  displayStatus: NasiyaDisplayStatus
}

/**
 * The smallest real UZS unit is one whole so'm. Only a fractional remainder
 * below that unit may be treated as arithmetic dust; 1 so'm is real debt and
 * must remain visible/payable. New inputs are whole-so'm-only, while this
 * strict threshold keeps legacy floating snapshots deterministic.
 */
export const COMPLETION_ROUNDING_TOLERANCE_UZS = 1

/** Outstanding (unpaid) balance of a schedule, never negative, snapped to 0 within tolerance. */
export function scheduleOutstanding(expectedAmount: number, paidAmount: number): number {
  const raw = Math.max(0, Number(expectedAmount) - Number(paidAmount))
  return raw < COMPLETION_ROUNDING_TOLERANCE_UZS ? 0 : raw
}

/**
 * Whether a nasiya's schedules are all effectively paid off (every row's
 * outstanding balance is within COMPLETION_ROUNDING_TOLERANCE_UZS of 0),
 * independent of the nasiya's stored `status`. Used to self-heal display
 * (badge/tab/buttons/score) for a nasiya whose status hasn't been persisted
 * as COMPLETED yet, and to decide whether a new payment should complete it.
 */
export function isNasiyaEffectivelyComplete(schedules: OverdueScheduleInput[]): boolean {
  return schedules.length > 0 && schedules.every(
    (s) => s.status === 'SETTLED' || scheduleOutstanding(s.expectedAmount, s.paidAmount) <= 0,
  )
}

/** Effective due instant of a schedule: an active defer (delayedUntil) wins. */
export function scheduleEffectiveDueTime(schedule: {
  dueDate: Date | string
  delayedUntil: Date | string | null
}): number {
  const raw = schedule.delayedUntil ?? schedule.dueDate
  return (raw instanceof Date ? raw : new Date(raw)).getTime()
}

/**
 * Canonical per-schedule overdue check. MUST stay identical to the dashboard
 * (shop-stats) and the payment route so every surface agrees.
 */
export function isScheduleOverdue(schedule: OverdueScheduleInput, now: Date = new Date()): boolean {
  if (schedule.status === 'PAID' || schedule.status === 'SETTLED') return false
  if (scheduleOutstanding(schedule.expectedAmount, schedule.paidAmount) <= 0) return false
  return isBeforeTashkentToday(new Date(scheduleEffectiveDueTime(schedule)), now)
}

/**
 * The status a single schedule row should DISPLAY. An unpaid row past its
 * effective due date reads as OVERDUE even if cron hasn't flipped the stored
 * status yet. A row within COMPLETION_ROUNDING_TOLERANCE_UZS of fully paid
 * reads as PAID even if a past payment left a stray rounding-dust remainder
 * in the stored status/paidAmount — otherwise the stored status stands.
 */
export function scheduleDisplayStatus(schedule: OverdueScheduleInput, now: Date = new Date()): string {
  if (schedule.status === 'SETTLED') return 'SETTLED'
  if (schedule.status !== 'PAID' && scheduleOutstanding(schedule.expectedAmount, schedule.paidAmount) <= 0) {
    return 'PAID'
  }
  return isScheduleOverdue(schedule, now) ? 'OVERDUE' : schedule.status
}

/**
 * Derive the display status + overdue summary for a whole nasiya from its
 * schedules. A contract is shown OVERDUE if the parent status is already
 * OVERDUE OR any schedule is overdue by the canonical predicate. COMPLETED /
 * CANCELLED parents keep their terminal status.
 */
export function deriveNasiyaOverdue(
  nasiya: { status: string; schedules: OverdueScheduleInput[] },
  now: Date = new Date(),
): NasiyaOverdueDerivation {
  const overdueSchedules = nasiya.schedules.filter((schedule) => isScheduleOverdue(schedule, now))
  const overdueAmount = overdueSchedules.reduce(
    (sum, schedule) => sum + scheduleOutstanding(schedule.expectedAmount, schedule.paidAmount),
    0,
  )

  const nextSchedule = nasiya.schedules
    .filter(
      (schedule) =>
        UNPAID_SCHEDULE_STATUS_SET.has(schedule.status) &&
        scheduleOutstanding(schedule.expectedAmount, schedule.paidAmount) > 0,
    )
    .sort((left, right) => scheduleEffectiveDueTime(left) - scheduleEffectiveDueTime(right))[0]

  let displayStatus: NasiyaDisplayStatus
  if (nasiya.status === 'CANCELLED') {
    displayStatus = 'CANCELLED'
    // Effectively-complete check runs even when the stored status hasn't been
    // persisted as COMPLETED yet (see isNasiyaEffectivelyComplete) — this is
    // what self-heals a nasiya stuck showing "Faol" purely from UZS<->USD
    // rounding dust, immediately, everywhere this derivation is used (list,
    // dashboard-adjacent stats, detail page), without a data migration.
  } else if (nasiya.status === 'COMPLETED' || isNasiyaEffectivelyComplete(nasiya.schedules)) {
    displayStatus = 'COMPLETED'
  } else if (nasiya.status === 'OVERDUE' || overdueSchedules.length > 0) {
    displayStatus = 'OVERDUE'
  } else {
    displayStatus = 'ACTIVE'
  }

  return {
    isOverdue: displayStatus === 'OVERDUE',
    overdueAmount,
    overdueCount: overdueSchedules.length,
    nextPaymentDate: nextSchedule ? new Date(scheduleEffectiveDueTime(nextSchedule)) : null,
    displayStatus,
  }
}
