/**
 * Pure nasiya-payment allocation logic — extracted from
 * src/app/api/nasiya/[id]/payment/route.ts so the rate-drift edge case
 * (item 4 of docs/product-feature-fixes.md's follow-up) can be unit-tested
 * directly, without a live database.
 *
 * THE EDGE CASE, PROVEN AND FIXED:
 *
 * Before this fix, a schedule's "is this fully paid" decision
 * (`isFullyPaid`) was computed PURELY from the legacy UZS ledger
 * (`scheduleOutstanding(expectedAmount, paidAmount)`), even though the
 * payment amount actually applied is tracked in BOTH ledgers (legacy UZS,
 * frozen-creation-rate `expectedAmount` vs. contract-currency
 * `contractExpectedAmount`). A USD-native nasiya paid across two or more
 * payments at DIFFERENT exchange rates can end up with the two ledgers
 * disagreeing about whether one particular schedule is done:
 *
 *   Example — $100 owed on one schedule, created when the rate was 12,000:
 *   legacy expectedAmount = 1,200,000 so'm (frozen forever).
 *     Payment 1: $60 paid @ rate 11,000  -> amountUzs = 660,000
 *     Payment 2: $40 paid @ rate 11,000  -> amountUzs = 440,000
 *     Legacy total applied = 1,100,000 (100,000 short of expectedAmount)
 *     -> legacy math says NOT fully paid (isFullyPaid would be false).
 *     Contract math: $60 + $40 = $100 = contractExpectedAmount exactly
 *     -> contract math says FULLY paid.
 *
 * Left as legacy-driven, this schedule would stay stuck at status
 * PARTIAL/OVERDUE forever, even though the customer's real (contract-
 * currency) debt for it is $0. Since the cron reminder queries
 * (src/app/api/cron/reminders/route.ts) select schedules purely by
 * `status`, this could send a live "you owe money" Telegram reminder for
 * an already-fully-paid schedule — a real user-facing bug, not just a
 * cosmetic one.
 *
 * THE FIX: `isFullyPaid`/`status` is now decided ENTIRELY from the
 * contract-currency ledger (the same ledger nasiya-level completion
 * already trusted — see `contractAllFullyPaid` in the payment route). The
 * legacy `paidAmount` is still updated (kept as a compatibility snapshot
 * for existing readers) but is SNAPPED to `expectedAmount` in lockstep
 * whenever the contract ledger says the schedule is done — exactly
 * mirroring the pattern already used at the nasiya level
 * (`remainingToStore = contractAllFullyPaid ? 0 : remaining`). Any
 * leftover/discarded legacy-UZS "remainingPayment" after a contract-driven
 * snap is a pure artifact of the non-authoritative legacy ledger — it
 * represents no real money, since nothing reads the legacy ledger as
 * authoritative for debt decisions (confirmed: neither schedule-level nor
 * nasiya-level completion do, after this fix).
 */

import { contractScheduleOutstanding } from '@/lib/nasiya-contract'
import { scheduleOutstanding } from '@/lib/nasiya-utils'
import type { CurrencyCode } from '@/lib/currency'

/** Matches the Prisma NasiyaScheduleStatus enum's PAID/PARTIAL/OVERDUE/PENDING members. */
export type NasiyaAllocationStatus = 'PAID' | 'PARTIAL' | 'OVERDUE' | 'PENDING'

export interface NasiyaAllocationScheduleInput {
  id: string
  monthNumber: number
  dueDate: Date
  delayedUntil: Date | null
  expectedAmount: number
  paidAmount: number
  contractExpectedAmount: number
  contractPaidAmount: number
}

export interface NasiyaAllocationUpdate {
  scheduleId: string
  monthNumber: number
  /** Legacy-UZS amount applied to this schedule this payment (compatibility snapshot only). */
  appliedUzs: number
  /** Contract-currency amount applied to this schedule this payment — the authoritative figure. */
  appliedContract: number
  newPaidAmount: number
  newContractPaidAmount: number
  newContractRemainingAmount: number
  status: NasiyaAllocationStatus
  /** Whether to stamp `paidAt` on this schedule — true only on the real PAID transition. */
  markPaidAt: boolean
}

/**
 * Allocates one payment across an ALREADY-ORDERED list of unpaid schedules
 * (selected schedule first, then oldest-unpaid-by-effective-due-date —
 * unchanged from the route's existing ordering, not this function's
 * concern). Stops once both the legacy and contract-currency payment
 * amounts are exhausted.
 */
export function allocateNasiyaPayment(params: {
  schedules: NasiyaAllocationScheduleInput[]
  amountUzs: number
  appliedAmountInContractCurrency: number
  contractCurrency: CurrencyCode
  now: Date
}): NasiyaAllocationUpdate[] {
  const { schedules, contractCurrency, now } = params
  let remainingPayment = params.amountUzs
  let remainingContractPayment = params.appliedAmountInContractCurrency
  const updates: NasiyaAllocationUpdate[] = []

  for (const schedule of schedules) {
    if (remainingPayment <= 0 && remainingContractPayment <= 0) break

    // Contract-currency side — computed FIRST because it alone decides
    // completion (see file doc comment).
    const contractOutstanding = contractScheduleOutstanding(schedule.contractExpectedAmount, schedule.contractPaidAmount, contractCurrency)
    const contractApplied = Math.min(remainingContractPayment, contractOutstanding)
    const newContractPaidAmountRaw = schedule.contractPaidAmount + contractApplied
    const isContractFullyPaid = contractScheduleOutstanding(schedule.contractExpectedAmount, newContractPaidAmountRaw, contractCurrency) <= 0
    const newContractPaidAmount = isContractFullyPaid ? schedule.contractExpectedAmount : newContractPaidAmountRaw
    const newContractRemainingAmount = Math.max(0, schedule.contractExpectedAmount - newContractPaidAmount)

    // Legacy-UZS side — a compatibility snapshot, never independently
    // deciding completion. Snapped up to expectedAmount whenever the
    // contract side closes, even if the legacy-math applied amount alone
    // wouldn't have reached expectedAmount (rate-drift item 4 fix).
    const legacyOutstanding = scheduleOutstanding(schedule.expectedAmount, schedule.paidAmount)
    const appliedUzs = Math.min(remainingPayment, legacyOutstanding)
    const newPaidAmountRaw = schedule.paidAmount + appliedUzs
    const newPaidAmount = isContractFullyPaid ? schedule.expectedAmount : newPaidAmountRaw

    const isPartial = !isContractFullyPaid && newPaidAmount > 0
    const effectiveDueDate = schedule.delayedUntil ?? schedule.dueDate
    const isPastDue = effectiveDueDate < now
    const status: NasiyaAllocationUpdate['status'] = isContractFullyPaid ? 'PAID' : isPastDue ? 'OVERDUE' : isPartial ? 'PARTIAL' : 'PENDING'

    updates.push({
      scheduleId: schedule.id,
      monthNumber: schedule.monthNumber,
      appliedUzs,
      appliedContract: contractApplied,
      newPaidAmount,
      newContractPaidAmount,
      newContractRemainingAmount,
      status,
      markPaidAt: isContractFullyPaid,
    })

    remainingPayment -= appliedUzs
    remainingContractPayment -= contractApplied
  }

  return updates
}

/**
 * Total outstanding balance across a set of schedules, in the nasiya's own
 * contract currency — the authoritative figure for the "does this payment
 * exceed the remaining debt" validation gate. Comparing a today's-rate
 * payment amount against a LEGACY-UZS-summed total (frozen at each
 * schedule's creation rate) is exactly the same rate-drift problem as
 * above: after real exchange-rate movement, the legacy sum can be smaller
 * than the real remaining contract debt, wrongly REJECTING a legitimate
 * final payment ("payment exceeds remaining") — or larger, wrongly
 * ALLOWING a real overpayment through. Comparing contract-to-contract
 * avoids both failure directions.
 */
export function totalContractOutstanding(
  schedules: Pick<NasiyaAllocationScheduleInput, 'contractExpectedAmount' | 'contractPaidAmount'>[],
  contractCurrency: CurrencyCode,
): number {
  return schedules.reduce(
    (sum, schedule) => sum + contractScheduleOutstanding(schedule.contractExpectedAmount, schedule.contractPaidAmount, contractCurrency),
    0,
  )
}
