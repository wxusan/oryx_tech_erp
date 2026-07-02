/**
 * Nasiya (instalment plan) calculation utilities for Oryx Tech ERP.
 */

import { addMonths } from 'date-fns'
import type { PaymentScheduleItem, NasiyaSchedule } from '@/types'
import { NasiyaScheduleStatus } from '@/types'

/**
 * Generate a monthly payment schedule for a nasiya plan.
 *
 * @param startDate     - The first payment's start date (payments due from month 1 onward)
 * @param months        - Total number of monthly instalments
 * @param remainingAmount - Total amount to distribute across all instalments
 * @returns Array of PaymentScheduleItem, one per month
 */
export function generatePaymentSchedule(
  startDate: Date,
  months: number,
  remainingAmount: number,
): PaymentScheduleItem[] {
  const schedule: PaymentScheduleItem[] = []
  const roundedTotal = Math.round(remainingAmount)
  const baseAmount = Math.floor(roundedTotal / months)
  const remainder = roundedTotal - baseAmount * months

  for (let i = 1; i <= months; i++) {
    schedule.push({
      monthNumber: i,
      dueDate: addMonths(startDate, i),
      expectedAmount: i === months ? baseAmount + remainder : baseAmount,
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
      (s.status === NasiyaScheduleStatus.OVERDUE || (s.delayedUntil ?? s.dueDate) < now),
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

/** Outstanding (unpaid) balance of a schedule, never negative. */
export function scheduleOutstanding(expectedAmount: number, paidAmount: number): number {
  return Math.max(0, Number(expectedAmount) - Number(paidAmount))
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
  if (schedule.status === 'PAID') return false
  if (scheduleOutstanding(schedule.expectedAmount, schedule.paidAmount) <= 0) return false
  return scheduleEffectiveDueTime(schedule) < now.getTime()
}

/**
 * The status a single schedule row should DISPLAY. An unpaid row past its
 * effective due date reads as OVERDUE even if cron hasn't flipped the stored
 * status yet; otherwise the stored status stands.
 */
export function scheduleDisplayStatus(schedule: OverdueScheduleInput, now: Date = new Date()): string {
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
  if (nasiya.status === 'COMPLETED') {
    displayStatus = 'COMPLETED'
  } else if (nasiya.status === 'CANCELLED') {
    displayStatus = 'CANCELLED'
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
