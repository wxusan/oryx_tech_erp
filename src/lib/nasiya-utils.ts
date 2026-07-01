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
      (s.status === NasiyaScheduleStatus.OVERDUE || s.dueDate < now),
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
    .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())

  return pending[0] ?? null
}
