/**
 * Contract-authoritative Nasiya schedule and parent status derivation.
 *
 * Contract currency is the source of truth for whether a debt is paid,
 * partial, overdue, or complete. The legacy UZS columns remain a historical
 * compatibility mirror only: FX movement can make them reach zero before or
 * after the native contract balance. Callers with genuinely pre-contract
 * data may fall back to `deriveNasiyaOverdue`; callers with native fields
 * must use this module instead.
 */

import { contractScheduleOutstanding } from '@/lib/nasiya-contract'
import { isCurrencyCode, type CurrencyCode } from '@/lib/currency'
import { isBeforeTashkentToday } from '@/lib/timezone'
import {
  deriveNasiyaOverdue,
  scheduleEffectiveDueTime,
  type NasiyaDisplayStatus,
  type NasiyaOverdueDerivation,
} from '@/lib/nasiya-utils'

type MoneyValue = number | string | null | undefined

export interface ContractStatusScheduleInput {
  status: string
  dueDate: Date | string
  delayedUntil: Date | string | null
  expectedAmount: MoneyValue
  paidAmount: MoneyValue
  contractExpectedAmount: MoneyValue
  contractPaidAmount: MoneyValue
}

export interface ContractNasiyaStatusInput {
  status: string
  contractCurrency: CurrencyCode | null | undefined
  contractFinalAmount: MoneyValue
  contractRemainingAmount: MoneyValue
  schedules: ContractStatusScheduleInput[]
}

export interface ContractScheduleStatusDerivation {
  displayStatus: 'PAID' | 'PARTIAL' | 'OVERDUE' | 'PENDING' | 'DEFERRED' | 'CANCELLED'
  outstanding: number
  isOverdue: boolean
}

export interface ContractNasiyaStatusDerivation extends NasiyaOverdueDerivation {
  /** True only when native contract fields, not legacy UZS mirrors, were used. */
  usesContractLedger: boolean
}

function finiteMoney(value: MoneyValue): number | null {
  if (value == null) return null
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : null
}

function hasContractScheduleAmounts(schedule: ContractStatusScheduleInput): boolean {
  return finiteMoney(schedule.contractExpectedAmount) != null && finiteMoney(schedule.contractPaidAmount) != null
}

/**
 * Derive one schedule's state from its own contract-currency balance.
 * Stored `PAID` is deliberately not trusted when its native balance is still
 * positive: that mismatch must never hide a debt or suppress overdue state.
 */
export function deriveContractScheduleStatus(
  schedule: ContractStatusScheduleInput,
  currency: CurrencyCode,
  now: Date = new Date(),
): ContractScheduleStatusDerivation {
  if (schedule.status === 'CANCELLED') {
    return { displayStatus: 'CANCELLED', outstanding: 0, isOverdue: false }
  }
  const expected = finiteMoney(schedule.contractExpectedAmount)
  const paid = finiteMoney(schedule.contractPaidAmount)

  // This function is called only after contract-field presence is established
  // by the parent derivation. A direct defensive fallback keeps malformed old
  // data readable without treating it as completed.
  if (expected == null || paid == null) {
    const legacyExpected = finiteMoney(schedule.expectedAmount) ?? 0
    const legacyPaid = finiteMoney(schedule.paidAmount) ?? 0
    const outstanding = Math.max(0, legacyExpected - legacyPaid)
    const isOverdue = outstanding > 0 && isBeforeTashkentToday(new Date(scheduleEffectiveDueTime(schedule)), now)
    return {
      displayStatus: outstanding <= 0 ? 'PAID' : isOverdue ? 'OVERDUE' : legacyPaid > 0 ? 'PARTIAL' : 'PENDING',
      outstanding,
      isOverdue,
    }
  }

  const outstanding = contractScheduleOutstanding(expected, paid, currency)
  if (outstanding <= 0) return { displayStatus: 'PAID', outstanding: 0, isOverdue: false }

  const isOverdue = isBeforeTashkentToday(new Date(scheduleEffectiveDueTime(schedule)), now)
  return {
    displayStatus: isOverdue ? 'OVERDUE' : paid > 0 ? 'PARTIAL' : schedule.status === 'DEFERRED' ? 'DEFERRED' : 'PENDING',
    outstanding,
    isOverdue,
  }
}

function legacyDerivation(nasiya: ContractNasiyaStatusInput, now: Date): ContractNasiyaStatusDerivation {
  const derived = deriveNasiyaOverdue(
    {
      status: nasiya.status,
      schedules: nasiya.schedules.map((schedule) => ({
        status: schedule.status,
        dueDate: schedule.dueDate,
        delayedUntil: schedule.delayedUntil,
        expectedAmount: finiteMoney(schedule.expectedAmount) ?? 0,
        paidAmount: finiteMoney(schedule.paidAmount) ?? 0,
      })),
    },
    now,
  )
  return { ...derived, usesContractLedger: false }
}

/**
 * Derive a parent Nasiya's display/overdue status from the contract ledger.
 * The only terminal stored state that remains authoritative is CANCELLED.
 * A stored COMPLETED is ignored while native contract fields show debt, so a
 * stale GET/self-heal can never block the payment needed to settle it.
 */
export function deriveContractNasiyaStatus(
  nasiya: ContractNasiyaStatusInput,
  now: Date = new Date(),
): ContractNasiyaStatusDerivation {
  const currency = nasiya.contractCurrency
  const hasContractParentAmounts =
    finiteMoney(nasiya.contractFinalAmount) != null || finiteMoney(nasiya.contractRemainingAmount) != null
  const hasContractScheduleData = nasiya.schedules.some(hasContractScheduleAmounts)

  // Explicit fallback only for records from before native contract fields
  // existed. Do not use it merely because a current row's legacy mirror says
  // paid: that is precisely the FX-drift bug this module prevents.
  if (!isCurrencyCode(currency) || (!hasContractParentAmounts && !hasContractScheduleData)) {
    return legacyDerivation(nasiya, now)
  }

  if (nasiya.status === 'CANCELLED') {
    return {
      displayStatus: 'CANCELLED',
      isOverdue: false,
      overdueAmount: 0,
      overdueCount: 0,
      nextPaymentDate: null,
      usesContractLedger: true,
    }
  }

  const schedules = nasiya.schedules.map((schedule) => ({
    schedule,
    derived: deriveContractScheduleStatus(schedule, currency, now),
  }))
  const hasMissingContractScheduleAmounts = nasiya.schedules.some((schedule) => !hasContractScheduleAmounts(schedule))
  const unpaidSchedules = schedules.filter(({ derived }) => derived.outstanding > 0)
  const overdueSchedules = unpaidSchedules.filter(({ derived }) => derived.isOverdue)
  const parentRemaining = finiteMoney(nasiya.contractRemainingAmount)

  // Prefer every authoritative schedule being settled when schedules exist;
  // for a legacy/imported parent with no rows, the native parent balance is
  // the only available contract-side evidence. This is intentionally stricter
  // than trusting a stale parent snapshot of zero while a schedule still owes.
  const completed =
    schedules.length > 0
      ? !hasMissingContractScheduleAmounts && unpaidSchedules.length === 0
      : parentRemaining != null && contractScheduleOutstanding(parentRemaining, 0, currency) <= 0

  const nextSchedule = [...unpaidSchedules].sort(
    (left, right) => scheduleEffectiveDueTime(left.schedule) - scheduleEffectiveDueTime(right.schedule),
  )[0]
  const displayStatus: NasiyaDisplayStatus = completed ? 'COMPLETED' : overdueSchedules.length > 0 ? 'OVERDUE' : 'ACTIVE'

  return {
    displayStatus,
    isOverdue: displayStatus === 'OVERDUE',
    overdueAmount: overdueSchedules.reduce((sum, { derived }) => sum + derived.outstanding, 0),
    overdueCount: overdueSchedules.length,
    nextPaymentDate: nextSchedule ? new Date(scheduleEffectiveDueTime(nextSchedule.schedule)) : null,
    usesContractLedger: true,
  }
}
