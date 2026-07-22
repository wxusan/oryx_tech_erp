import {
  createMoneyDto,
  moneyDtoToAmount,
  moneyMinorUnitScale,
  type CurrencyCode,
  type MoneyDto,
} from '@/lib/currency'

export type NasiyaSettlementMode = 'FULL_WITH_PROFIT' | 'WAIVE_REMAINING_PROFIT'
export type NasiyaSettlementScheduleStatus = 'PAID' | 'SETTLED'

type MoneyValue = number | string

export interface NasiyaSettlementScheduleInput {
  id: string
  monthNumber: number
  contractExpectedAmount: MoneyValue
  contractPaidAmount: MoneyValue
  contractRemainingAmount: MoneyValue
  contractInterestWaivedAmount?: MoneyValue
  contractPrincipalAmount: MoneyValue
  contractMarginAmount: MoneyValue
  contractInterestAmount: MoneyValue
  contractPrincipalPaidAmount: MoneyValue
  contractMarginPaidAmount: MoneyValue
  contractInterestPaidAmount: MoneyValue
}

export interface NasiyaSettlementInput {
  mode: NasiyaSettlementMode
  contractCurrency: CurrencyCode
  contractRemainingAmount: MoneyValue
  contractPaidAmount: MoneyValue
  contractInterestWaivedAmount?: MoneyValue
  accountingReconstructionStatus: string
  schedules: NasiyaSettlementScheduleInput[]
}

export interface NasiyaSettlementComponentAllocation {
  principal: number
  margin: number
  interest: number
}

export interface NasiyaSettlementScheduleQuote {
  scheduleId: string
  monthNumber: number
  remainingBefore: MoneyDto
  cash: MoneyDto
  interestWaived: MoneyDto
  remainingAfter: MoneyDto
  status: NasiyaSettlementScheduleStatus
  cashComponents: NasiyaSettlementComponentAllocation | null
  paidComponentsAfter: NasiyaSettlementComponentAllocation | null
}

export interface NasiyaSettlementQuote {
  mode: NasiyaSettlementMode
  contractCurrency: CurrencyCode
  remainingBefore: MoneyDto
  cashToReceive: MoneyDto
  interestToWaive: MoneyDto
  remainingAfter: MoneyDto
  schedules: NasiyaSettlementScheduleQuote[]
  waiverEligible: boolean
  waiverIneligibilityReasons: string[]
}

export interface NasiyaSettlementRecordDto {
  id: string
  mode: NasiyaSettlementMode
  contractCurrency: CurrencyCode
  remainingBefore: MoneyDto
  cashReceived: MoneyDto
  interestWaived: MoneyDto
  remainingAfter: MoneyDto
  cashReceivedUzs: MoneyDto
  interestWaivedUzs: MoneyDto
  settledAt: string
  reason: string | null
  actorId: string
  actorType: string
}

export interface NasiyaSettlementMutationResult {
  settlement: NasiyaSettlementRecordDto
  receipt: {
    input: MoneyDto
    recordedUzs: MoneyDto
    applied: MoneyDto
    paymentMethod: string | null
    paymentBreakdown: unknown
    paidAt: string
    paymentFxQuote: unknown
  } | null
  ledger: {
    paid: MoneyDto
    waived: MoneyDto
    fulfilled: MoneyDto
    remaining: MoneyDto
    status: string
  }
  allocations: Array<{
    scheduleId: string
    sequence: number
    remainingBefore: MoneyDto
    cash: MoneyDto
    interestWaived: MoneyDto
    remainingAfter: MoneyDto
    cashUzs: MoneyDto
    interestWaivedUzs: MoneyDto
  }>
  duplicate: boolean
}

function toUnits(value: MoneyValue, currency: CurrencyCode, field: string): number {
  const amount = Number(value)
  const scale = moneyMinorUnitScale(currency)
  const units = Math.round(amount * scale)
  if (!Number.isFinite(amount) || !Number.isSafeInteger(units) || Math.abs(amount * scale - units) > 1e-8) {
    throw new Error(`${field} has invalid precision`)
  }
  return units
}

function nonNegativeUnits(value: MoneyValue, currency: CurrencyCode, field: string): number {
  const units = toUnits(value, currency, field)
  if (units < 0) throw new Error(`${field} cannot be negative`)
  return units
}

function amount(units: number, currency: CurrencyCode): number {
  return units / moneyMinorUnitScale(currency)
}

function money(units: number, currency: CurrencyCode): MoneyDto {
  return createMoneyDto(currency, amount(units, currency))
}

/**
 * Calculate an exact early-settlement quote without mutating any ledger row.
 *
 * FULL_WITH_PROFIT receives every remaining unit. WAIVE_REMAINING_PROFIT
 * receives only the unpaid principal + ordinary sale margin and waives only
 * the still-unpaid Nasiya interest. Previously paid interest is never moved or
 * reversed. Signed margin is retained so below-cost sales keep their real loss.
 */
export function calculateNasiyaSettlement(input: NasiyaSettlementInput): NasiyaSettlementQuote {
  const currency = input.contractCurrency
  const parentRemaining = nonNegativeUnits(input.contractRemainingAmount, currency, 'contractRemainingAmount')
  const parentPaid = nonNegativeUnits(input.contractPaidAmount, currency, 'contractPaidAmount')
  const parentWaived = nonNegativeUnits(
    input.contractInterestWaivedAmount ?? 0,
    currency,
    'contractInterestWaivedAmount',
  )
  const waiverReasons: string[] = []
  if (!['COMPLETE', 'PARTIAL'].includes(input.accountingReconstructionStatus)) {
    waiverReasons.push('Foyda tarkibi ishonchli tiklanmagan')
  }

  let schedulePaidTotal = 0
  let scheduleWaivedTotal = 0
  let scheduleRemainingTotal = 0
  let totalCash = 0
  let totalWaived = 0

  const schedules = input.schedules.map((schedule): NasiyaSettlementScheduleQuote => {
    const prefix = `schedule ${schedule.id}`
    const expected = nonNegativeUnits(schedule.contractExpectedAmount, currency, `${prefix} expected`)
    const paid = nonNegativeUnits(schedule.contractPaidAmount, currency, `${prefix} paid`)
    const waivedBefore = nonNegativeUnits(
      schedule.contractInterestWaivedAmount ?? 0,
      currency,
      `${prefix} waived`,
    )
    const remaining = nonNegativeUnits(schedule.contractRemainingAmount, currency, `${prefix} remaining`)
    if (expected !== paid + waivedBefore + remaining) {
      throw new Error(`${prefix} expected does not equal paid plus waived plus remaining`)
    }

    schedulePaidTotal += paid
    scheduleWaivedTotal += waivedBefore
    scheduleRemainingTotal += remaining

    const principal = nonNegativeUnits(schedule.contractPrincipalAmount, currency, `${prefix} principal`)
    const margin = toUnits(schedule.contractMarginAmount, currency, `${prefix} margin`)
    const interest = nonNegativeUnits(schedule.contractInterestAmount, currency, `${prefix} interest`)
    const principalPaid = nonNegativeUnits(
      schedule.contractPrincipalPaidAmount,
      currency,
      `${prefix} principal paid`,
    )
    const marginPaid = toUnits(schedule.contractMarginPaidAmount, currency, `${prefix} margin paid`)
    const interestPaid = nonNegativeUnits(
      schedule.contractInterestPaidAmount,
      currency,
      `${prefix} interest paid`,
    )

    const componentsReconcile =
      principal + margin + interest === expected &&
      principalPaid + marginPaid + interestPaid === paid &&
      principalPaid <= principal &&
      marginPaid >= Math.min(0, margin) &&
      marginPaid <= Math.max(0, margin) &&
      interestPaid + waivedBefore <= interest

    if (!componentsReconcile) {
      waiverReasons.push(`Foyda tarkibi ${schedule.monthNumber}-oy jadvali bilan mos emas`)
    }

    let cash = remaining
    let waivedNow = 0
    let cashComponents: NasiyaSettlementComponentAllocation | null = null
    let paidComponentsAfter: NasiyaSettlementComponentAllocation | null = null

    if (componentsReconcile) {
      const principalRemaining = principal - principalPaid
      const marginRemaining = margin - marginPaid
      const interestRemaining = interest - interestPaid - waivedBefore
      const baseCash = principalRemaining + marginRemaining
      if (baseCash < 0 || interestRemaining < 0 || baseCash + interestRemaining !== remaining) {
        waiverReasons.push(`Qolgan summa ${schedule.monthNumber}-oy foyda tarkibi bilan mos emas`)
      } else if (input.mode === 'WAIVE_REMAINING_PROFIT') {
        cash = baseCash
        waivedNow = interestRemaining
        cashComponents = {
          principal: amount(principalRemaining, currency),
          margin: amount(marginRemaining, currency),
          interest: 0,
        }
        paidComponentsAfter = {
          principal: amount(principal, currency),
          margin: amount(margin, currency),
          interest: amount(interestPaid, currency),
        }
      } else {
        cashComponents = {
          principal: amount(principalRemaining, currency),
          margin: amount(marginRemaining, currency),
          interest: amount(interestRemaining, currency),
        }
        paidComponentsAfter = {
          principal: amount(principal, currency),
          margin: amount(margin, currency),
          interest: amount(interest - waivedBefore, currency),
        }
      }
    }

    totalCash += cash
    totalWaived += waivedNow
    return {
      scheduleId: schedule.id,
      monthNumber: schedule.monthNumber,
      remainingBefore: money(remaining, currency),
      cash: money(cash, currency),
      interestWaived: money(waivedNow, currency),
      remainingAfter: money(0, currency),
      status: waivedBefore + waivedNow > 0 ? 'SETTLED' : 'PAID',
      cashComponents,
      paidComponentsAfter,
    }
  })

  if (schedulePaidTotal !== parentPaid) throw new Error('Parent paid amount differs from schedules')
  if (scheduleWaivedTotal !== parentWaived) throw new Error('Parent waived amount differs from schedules')
  if (scheduleRemainingTotal !== parentRemaining) throw new Error('Parent remaining amount differs from schedules')
  if (totalCash + totalWaived !== parentRemaining) {
    throw new Error('Settlement cash plus waiver does not equal remaining debt')
  }
  if (input.mode === 'WAIVE_REMAINING_PROFIT' && totalWaived <= 0) {
    waiverReasons.push('Kechiladigan kelgusi foyda qolmagan')
  }

  const waiverIneligibilityReasons = [...new Set(waiverReasons)]
  return {
    mode: input.mode,
    contractCurrency: currency,
    remainingBefore: money(parentRemaining, currency),
    cashToReceive: money(totalCash, currency),
    interestToWaive: money(totalWaived, currency),
    remainingAfter: money(0, currency),
    schedules,
    waiverEligible: waiverIneligibilityReasons.length === 0,
    waiverIneligibilityReasons,
  }
}

export function settlementMoneyAmount(value: MoneyDto): number {
  return moneyDtoToAmount(value)
}
