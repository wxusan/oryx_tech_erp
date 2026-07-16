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

import { createMoneyDto, moneyDtoToAmount, moneyMinorUnitScale, type CurrencyCode } from '@/lib/currency'
import { isBeforeTashkentToday } from '@/lib/timezone'

/** Matches the Prisma NasiyaScheduleStatus enum's PAID/PARTIAL/OVERDUE/PENDING members. */
export type NasiyaAllocationStatus = 'PAID' | 'PARTIAL' | 'OVERDUE' | 'PENDING'

type MoneyValue = number | string

export interface NasiyaAllocationScheduleInput {
  id: string
  monthNumber: number
  dueDate: Date
  delayedUntil: Date | null
  expectedAmount: MoneyValue
  paidAmount: MoneyValue
  contractExpectedAmount: MoneyValue
  contractPaidAmount: MoneyValue
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
 * Route input has already passed the strict MoneyDto boundary. This small
 * adapter preserves the old pure-helper behaviour for sub-unit floating dust
 * in unit tests while immediately moving the allocation itself to integers.
 */
function allocatableMinorUnits(amount: MoneyValue, currency: CurrencyCode): number {
  const numeric = Number(amount)
  if (!Number.isFinite(numeric) || numeric <= 0) return 0
  const scaled = numeric * moneyMinorUnitScale(currency)
  const minorUnits = Math.floor(scaled + 1e-8)
  return Number.isSafeInteger(minorUnits) && minorUnits > 0 ? minorUnits : 0
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
  amountUzs: MoneyValue
  appliedAmountInContractCurrency: MoneyValue
  contractCurrency: CurrencyCode
  now: Date
}): NasiyaAllocationUpdate[] {
  const { schedules, contractCurrency, now } = params
  let remainingPaymentMinorUnits = allocatableMinorUnits(params.amountUzs, 'UZS')
  let remainingContractMinorUnits = allocatableMinorUnits(params.appliedAmountInContractCurrency, contractCurrency)
  const updates: NasiyaAllocationUpdate[] = []

  for (const schedule of schedules) {
    if (remainingContractMinorUnits <= 0) break

    // Contract-currency side — computed FIRST because it alone decides
    // completion (see file doc comment).
    const contractExpected = createMoneyDto(contractCurrency, schedule.contractExpectedAmount)
    const contractPaid = createMoneyDto(contractCurrency, schedule.contractPaidAmount)
    const contractOutstandingMinorUnits = Math.max(0, contractExpected.minorUnits - contractPaid.minorUnits)
    if (contractOutstandingMinorUnits <= 0) continue

    const contractAppliedMinorUnits = Math.min(remainingContractMinorUnits, contractOutstandingMinorUnits)
    if (contractAppliedMinorUnits <= 0) break

    const newContractPaidMinorUnitsRaw = contractPaid.minorUnits + contractAppliedMinorUnits
    const isContractFullyPaid = newContractPaidMinorUnitsRaw >= contractExpected.minorUnits
    const newContractPaidMinorUnits = isContractFullyPaid ? contractExpected.minorUnits : newContractPaidMinorUnitsRaw
    const newContractRemainingMinorUnits = contractExpected.minorUnits - newContractPaidMinorUnits

    // Legacy-UZS side — a compatibility snapshot, never independently
    // deciding completion. Snapped up to expectedAmount whenever the
    // contract side closes, even if the legacy-math applied amount alone
    // wouldn't have reached expectedAmount (rate-drift item 4 fix).
    const legacyExpected = createMoneyDto('UZS', schedule.expectedAmount)
    const legacyPaid = createMoneyDto('UZS', schedule.paidAmount)
    const legacyOutstandingMinorUnits = Math.max(0, legacyExpected.minorUnits - legacyPaid.minorUnits)
    const appliedUzsMinorUnits = Math.min(remainingPaymentMinorUnits, legacyOutstandingMinorUnits)
    const newPaidMinorUnitsRaw = legacyPaid.minorUnits + appliedUzsMinorUnits
    const newPaidMinorUnits = isContractFullyPaid ? legacyExpected.minorUnits : newPaidMinorUnitsRaw

    const isPartial = !isContractFullyPaid && newContractPaidMinorUnits > 0
    const effectiveDueDate = schedule.delayedUntil ?? schedule.dueDate
    const isPastDue = isBeforeTashkentToday(effectiveDueDate, now)
    const status: NasiyaAllocationUpdate['status'] = isContractFullyPaid ? 'PAID' : isPastDue ? 'OVERDUE' : isPartial ? 'PARTIAL' : 'PENDING'

    updates.push({
      scheduleId: schedule.id,
      monthNumber: schedule.monthNumber,
      appliedUzs: moneyDtoToAmount({ currency: 'UZS', minorUnits: appliedUzsMinorUnits }),
      appliedContract: moneyDtoToAmount({ currency: contractCurrency, minorUnits: contractAppliedMinorUnits }),
      newPaidAmount: moneyDtoToAmount({ currency: 'UZS', minorUnits: newPaidMinorUnits }),
      newContractPaidAmount: moneyDtoToAmount({ currency: contractCurrency, minorUnits: newContractPaidMinorUnits }),
      newContractRemainingAmount: moneyDtoToAmount({ currency: contractCurrency, minorUnits: newContractRemainingMinorUnits }),
      status,
      markPaidAt: isContractFullyPaid,
    })

    remainingPaymentMinorUnits -= appliedUzsMinorUnits
    remainingContractMinorUnits -= contractAppliedMinorUnits
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
  const minorUnits = schedules.reduce((sum, schedule) => {
    const expected = createMoneyDto(contractCurrency, schedule.contractExpectedAmount)
    const paid = createMoneyDto(contractCurrency, schedule.contractPaidAmount)
    return sum + Math.max(0, expected.minorUnits - paid.minorUnits)
  }, 0)
  return moneyDtoToAmount({ currency: contractCurrency, minorUnits })
}
