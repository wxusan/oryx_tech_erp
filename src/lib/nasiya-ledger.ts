/**
 * Authoritative Nasiya ledger projection.
 *
 * Contract terms say what was agreed. Schedule rows say what remains owed.
 * Parent Nasiya paid/remaining/status fields are deliberately treated as a
 * cache and are never used to calculate debt here. This module is safe to
 * use in routes, mutations, server lists, reports, and client DTO mapping.
 */

import {
  addMoneyDto,
  assertMoneyDto,
  createMoneyDto,
  moneyDtoEquals,
  moneyDtoToAmount,
  type CurrencyCode,
  type MoneyDto,
} from '@/lib/currency'
import { deriveContractNasiyaStatus } from '@/lib/nasiya-contract-status'
import { isBeforeTashkentToday } from '@/lib/timezone'

type MoneyValue = number | string | null | undefined

export type NasiyaLedgerHealth = 'HEALTHY' | 'REPAIRABLE_PARENT_CACHE' | 'QUARANTINED'
export type AllocationLedgerState = 'COMPLETE' | 'UNAVAILABLE' | 'MISMATCH'

export interface NasiyaLedgerScheduleInput {
  id: string
  status: string
  dueDate: Date | string
  delayedUntil?: Date | string | null
  /** Legacy UZS mirrors, only used by the existing status fallback. */
  expectedAmount?: MoneyValue
  paidAmount?: MoneyValue
  contractCurrency: CurrencyCode | string | null | undefined
  contractExpectedAmount: MoneyValue
  contractPaidAmount: MoneyValue
  contractInterestWaivedAmount?: MoneyValue
  contractRemainingAmount: MoneyValue
}

export interface NasiyaLedgerAllocationInput {
  nasiyaScheduleId: string | null
  contractCurrency: CurrencyCode | string | null | undefined
  contractAmount: MoneyValue
}

export interface NasiyaLedgerInput {
  status: string
  contractCurrency: CurrencyCode
  contractFinalAmount: MoneyValue
  contractPaidAmount: MoneyValue
  contractInterestWaivedAmount?: MoneyValue
  contractRemainingAmount: MoneyValue
  schedules: NasiyaLedgerScheduleInput[]
  /** Only set true once allocation reconstruction has been verified. */
  allocationHistoryComplete?: boolean
  allocations?: NasiyaLedgerAllocationInput[]
}

export interface NasiyaLedgerScheduleDto {
  id: string
  expected: MoneyDto
  paid: MoneyDto
  waived: MoneyDto
  remaining: MoneyDto
}

export interface NasiyaLedgerDto {
  contractCurrency: CurrencyCode
  financed: MoneyDto
  paid: MoneyDto
  waived: MoneyDto
  fulfilled: MoneyDto
  remaining: MoneyDto
  parentPaid: MoneyDto
  parentWaived: MoneyDto
  parentRemaining: MoneyDto
  scheduleCount: number
  schedules: NasiyaLedgerScheduleDto[]
  status: 'ACTIVE' | 'COMPLETED' | 'OVERDUE' | 'CANCELLED'
  isOverdue: boolean
  overdue: MoneyDto
  overdueCount: number
  nextPaymentDate: string | null
  health: NasiyaLedgerHealth
  reasons: string[]
  allocationLedger: AllocationLedgerState
  parentInSync: boolean
  /** A write-safe proposal, present only when caches are the sole mismatch. */
  repair: {
    contractPaid: MoneyDto
    contractWaived: MoneyDto
    contractRemaining: MoneyDto
    status: 'ACTIVE' | 'COMPLETED' | 'OVERDUE' | 'CANCELLED'
  } | null
}

function isCurrency(value: unknown): value is CurrencyCode {
  return value === 'UZS' || value === 'USD'
}

function zero(currency: CurrencyCode): MoneyDto {
  return { currency, minorUnits: 0 }
}

function safeMoney(value: MoneyValue, currency: CurrencyCode, field: string, reasons: string[]): MoneyDto {
  try {
    return createMoneyDto(currency, value == null ? 0 : value)
  } catch {
    reasons.push(`${field}: invalid precision or value`)
    return zero(currency)
  }
}

function sumMoney(currency: CurrencyCode, values: MoneyDto[]): MoneyDto {
  return values.reduce((total, value) => addMoneyDto(total, value), zero(currency))
}

function scheduleStatusInput(
  schedule: NasiyaLedgerScheduleInput,
  currency: CurrencyCode,
  expected: MoneyDto,
  paid: MoneyDto,
  waived: MoneyDto,
  remaining: MoneyDto,
) {
  return {
    status: schedule.status,
    dueDate: schedule.dueDate,
    delayedUntil: schedule.delayedUntil ?? null,
    expectedAmount: schedule.expectedAmount ?? moneyDtoToAmount(expected),
    paidAmount: schedule.paidAmount ?? moneyDtoToAmount(paid),
    contractExpectedAmount: moneyDtoToAmount(expected),
    contractPaidAmount: moneyDtoToAmount(paid),
    contractInterestWaivedAmount: moneyDtoToAmount(waived),
    contractRemainingAmount: moneyDtoToAmount(remaining),
  }
}

function expectedScheduleStatus(
  schedule: NasiyaLedgerScheduleInput,
  paid: MoneyDto,
  waived: MoneyDto,
  remaining: MoneyDto,
  now: Date,
): 'PAID' | 'SETTLED' | 'PENDING' | 'PARTIAL' | 'OVERDUE' | 'DEFERRED' | 'CANCELLED' {
  if (schedule.status === 'CANCELLED') return 'CANCELLED'
  if (remaining.minorUnits === 0) return waived.minorUnits > 0 ? 'SETTLED' : 'PAID'
  const effectiveDue = schedule.delayedUntil ?? schedule.dueDate
  if (isBeforeTashkentToday(new Date(effectiveDue), now)) return 'OVERDUE'
  if (schedule.status === 'DEFERRED' && schedule.delayedUntil) return 'DEFERRED'
  return paid.minorUnits > 0 ? 'PARTIAL' : 'PENDING'
}

/**
 * Reconcile a Nasiya without mutating it. Invalid schedule/payment evidence
 * is quarantined. Only a parent-cache disagreement produces a repair proposal.
 */
export function reconcileNasiyaLedger(input: NasiyaLedgerInput, now: Date = new Date()): NasiyaLedgerDto {
  const reasons: string[] = []
  const currency = input.contractCurrency
  const financed = safeMoney(input.contractFinalAmount, currency, 'contractFinalAmount', reasons)
  const parentPaid = safeMoney(input.contractPaidAmount, currency, 'contractPaidAmount', reasons)
  const parentWaived = safeMoney(input.contractInterestWaivedAmount, currency, 'contractInterestWaivedAmount', reasons)
  const parentRemaining = safeMoney(input.contractRemainingAmount, currency, 'contractRemainingAmount', reasons)
  if (financed.minorUnits <= 0) reasons.push('contractFinalAmount must be positive')

  const schedules = input.schedules.map((schedule) => {
    const scheduleCurrency = isCurrency(schedule.contractCurrency) ? schedule.contractCurrency : null
    if (scheduleCurrency !== currency) {
      reasons.push(`schedule ${schedule.id}: contract currency mismatch`)
    }
    const expected = safeMoney(schedule.contractExpectedAmount, currency, `schedule ${schedule.id} expected`, reasons)
    const paid = safeMoney(schedule.contractPaidAmount, currency, `schedule ${schedule.id} paid`, reasons)
    const waived = safeMoney(schedule.contractInterestWaivedAmount, currency, `schedule ${schedule.id} waived`, reasons)
    const remaining = safeMoney(schedule.contractRemainingAmount, currency, `schedule ${schedule.id} remaining`, reasons)

    try {
      if (!moneyDtoEquals(expected, addMoneyDto(addMoneyDto(paid, waived), remaining))) {
        reasons.push(`schedule ${schedule.id}: expected does not equal paid plus waived plus remaining`)
      }
    } catch {
      reasons.push(`schedule ${schedule.id}: invalid balance`)
    }

    if (expected.minorUnits <= 0) reasons.push(`schedule ${schedule.id}: expected amount must be positive`)
    const expectedStatus = expectedScheduleStatus(schedule, paid, waived, remaining, now)
    if (schedule.status === 'CANCELLED' && remaining.minorUnits > 0) {
      reasons.push(`schedule ${schedule.id}: cancelled schedule has remaining debt`)
    } else if (schedule.status !== expectedStatus) {
      reasons.push(`schedule ${schedule.id}: status differs from schedule-derived status`)
    }

    return { source: schedule, expected, paid, waived, remaining }
  })

  const scheduleExpected = sumMoney(currency, schedules.map((schedule) => schedule.expected))
  const schedulePaid = sumMoney(currency, schedules.map((schedule) => schedule.paid))
  const scheduleWaived = sumMoney(currency, schedules.map((schedule) => schedule.waived))
  const scheduleRemaining = sumMoney(currency, schedules.map((schedule) => schedule.remaining))

  if (schedules.length === 0) reasons.push('contract has no schedules')
  if (!moneyDtoEquals(scheduleExpected, financed)) reasons.push('schedule total does not equal financed contract amount')
  try {
    if (!moneyDtoEquals(scheduleExpected, addMoneyDto(addMoneyDto(schedulePaid, scheduleWaived), scheduleRemaining))) {
      reasons.push('schedule aggregates do not reconcile')
    }
  } catch {
    reasons.push('schedule aggregate balance is invalid')
  }

  let allocationLedger: AllocationLedgerState = input.allocationHistoryComplete ? 'COMPLETE' : 'UNAVAILABLE'
  if (input.allocationHistoryComplete) {
    const allocationBySchedule = new Map<string, MoneyDto>()
    for (const allocation of input.allocations ?? []) {
      if (!allocation.nasiyaScheduleId) continue // down payment: not instalment debt
      if (allocation.contractCurrency !== currency) {
        reasons.push(`allocation ${allocation.nasiyaScheduleId}: contract currency mismatch`)
        allocationLedger = 'MISMATCH'
        continue
      }
      const amount = safeMoney(allocation.contractAmount, currency, `allocation ${allocation.nasiyaScheduleId}`, reasons)
      const previous = allocationBySchedule.get(allocation.nasiyaScheduleId) ?? zero(currency)
      allocationBySchedule.set(allocation.nasiyaScheduleId, addMoneyDto(previous, amount))
    }
    for (const schedule of schedules) {
      const allocated = allocationBySchedule.get(schedule.source.id) ?? zero(currency)
      if (!moneyDtoEquals(allocated, schedule.paid)) {
        reasons.push(`schedule ${schedule.source.id}: allocation evidence disagrees with paid amount`)
        allocationLedger = 'MISMATCH'
      }
    }
  }

  const derivedStatus = deriveContractNasiyaStatus(
    {
      status: input.status,
      contractCurrency: currency,
      contractFinalAmount: moneyDtoToAmount(financed),
      // Deliberately use schedule truth rather than the parent cache.
      contractRemainingAmount: moneyDtoToAmount(scheduleRemaining),
      schedules: schedules.map(({ source, expected, paid, waived, remaining }) => scheduleStatusInput(source, currency, expected, paid, waived, remaining)),
    },
    now,
  )

  const status = derivedStatus.displayStatus
  const parentInSync =
    moneyDtoEquals(parentPaid, schedulePaid) &&
    moneyDtoEquals(parentWaived, scheduleWaived) &&
    moneyDtoEquals(parentRemaining, scheduleRemaining) &&
    input.status === status

  if (!moneyDtoEquals(parentPaid, schedulePaid)) reasons.push('parent paid cache differs from schedules')
  if (!moneyDtoEquals(parentWaived, scheduleWaived)) reasons.push('parent waived cache differs from schedules')
  if (!moneyDtoEquals(parentRemaining, scheduleRemaining)) reasons.push('parent remaining cache differs from schedules')
  if (input.status !== status) reasons.push('parent status differs from schedule-derived status')

  const evidenceReasons = reasons.filter((reason) => !reason.startsWith('parent '))
  const onlyParentCacheMismatch =
    input.status !== 'CANCELLED' &&
    evidenceReasons.length === 0 &&
    !parentInSync
  const health: NasiyaLedgerHealth = reasons.length === 0
    ? 'HEALTHY'
    : onlyParentCacheMismatch
      ? 'REPAIRABLE_PARENT_CACHE'
      : 'QUARANTINED'

  return {
    contractCurrency: currency,
    financed,
    paid: schedulePaid,
    waived: scheduleWaived,
    fulfilled: addMoneyDto(schedulePaid, scheduleWaived),
    remaining: scheduleRemaining,
    parentPaid,
    parentWaived,
    parentRemaining,
    scheduleCount: schedules.length,
    schedules: schedules.map(({ source, expected, paid, waived, remaining }) => ({ id: source.id, expected, paid, waived, remaining })),
    status,
    isOverdue: derivedStatus.isOverdue,
    overdue: createMoneyDto(currency, derivedStatus.overdueAmount),
    overdueCount: derivedStatus.overdueCount,
    nextPaymentDate: derivedStatus.nextPaymentDate?.toISOString() ?? null,
    health,
    reasons,
    allocationLedger,
    parentInSync,
    repair: health === 'REPAIRABLE_PARENT_CACHE'
      ? { contractPaid: schedulePaid, contractWaived: scheduleWaived, contractRemaining: scheduleRemaining, status }
      : null,
  }
}

/** Converts a DTO back to exact database-friendly values at the boundary only. */
export function moneyDtoDatabaseAmount(value: MoneyDto): number {
  return moneyDtoToAmount(assertMoneyDto(value))
}
