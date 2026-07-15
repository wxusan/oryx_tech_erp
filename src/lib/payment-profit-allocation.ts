import type { CurrencyCode } from '@/lib/currency'
import { roundContractMoney } from '@/lib/nasiya-contract'

export interface ProfitComponents {
  principal: number
  margin: number
  interest: number
}

export interface NasiyaScheduleComponentPlan extends ProfitComponents {
  expectedAmount: number
}

export interface NasiyaComponentPlan {
  costBasisAmount: number
  marginAmount: number
  downPayment: ProfitComponents
  schedules: NasiyaScheduleComponentPlan[]
}

function unitsPerAmount(currency: CurrencyCode) {
  return currency === 'USD' ? 100 : 1
}

function toUnits(amount: number, currency: CurrencyCode) {
  return Math.round(roundContractMoney(amount, currency) * unitsPerAmount(currency))
}

function fromUnits(units: number, currency: CurrencyCode) {
  return units / unitsPerAmount(currency)
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0)
}

/**
 * Allocate a total across non-negative weights with cumulative rounding. Every
 * prefix is rounded once and the last item absorbs the remainder, so the
 * output always reconciles exactly in whole UZS or USD cents.
 */
function allocateUnitsByWeight(totalUnits: number, weightUnits: number[]): number[] {
  const totalWeight = sum(weightUnits)
  if (weightUnits.length === 0) return []
  if (totalWeight <= 0) return weightUnits.map(() => 0)

  let cumulativeWeight = 0
  let allocated = 0
  return weightUnits.map((weight, index) => {
    cumulativeWeight += weight
    const cumulativeTarget = index === weightUnits.length - 1
      ? totalUnits
      : Math.round(totalUnits * (cumulativeWeight / totalWeight))
    const amount = cumulativeTarget - allocated
    allocated = cumulativeTarget
    return amount
  })
}

/**
 * Freeze the cost-recovery, ordinary device-margin, and interest budget for a
 * Nasiya contract. Interest is distributed over schedule rows; the remaining
 * base-sale value (down payment + schedule base) carries cost and margin.
 */
export function buildNasiyaComponentPlan(input: {
  currency: CurrencyCode
  totalAmount: number
  downPayment: number
  interestAmount: number
  costBasisAmount: number
  scheduleExpectedAmounts: number[]
}): NasiyaComponentPlan {
  const { currency } = input
  const totalUnits = toUnits(input.totalAmount, currency)
  const downUnits = toUnits(input.downPayment, currency)
  const interestUnits = toUnits(input.interestAmount, currency)
  const costUnits = toUnits(input.costBasisAmount, currency)
  const expectedUnits = input.scheduleExpectedAmounts.map((amount) => toUnits(amount, currency))
  const finalUnits = sum(expectedUnits)

  if (totalUnits <= 0 || downUnits < 0 || downUnits > totalUnits) {
    throw new Error('Nasiya component plan has invalid sale/down-payment totals')
  }
  if (interestUnits < 0 || finalUnits !== totalUnits - downUnits + interestUnits) {
    throw new Error('Nasiya component plan does not reconcile with its schedule')
  }
  if (costUnits < 0) throw new Error('Nasiya cost basis cannot be negative')

  const scheduleInterestUnits = allocateUnitsByWeight(interestUnits, expectedUnits)
  const scheduleBaseUnits = expectedUnits.map((expected, index) => expected - scheduleInterestUnits[index])
  if (scheduleBaseUnits.some((amount) => amount < 0) || downUnits + sum(scheduleBaseUnits) !== totalUnits) {
    throw new Error('Nasiya base-sale components do not reconcile')
  }

  const baseChunks = [downUnits, ...scheduleBaseUnits]
  const principalChunks = allocateUnitsByWeight(costUnits, baseChunks)
  const marginChunks = baseChunks.map((amount, index) => amount - principalChunks[index])

  return {
    costBasisAmount: fromUnits(costUnits, currency),
    marginAmount: fromUnits(totalUnits - costUnits, currency),
    downPayment: {
      principal: fromUnits(principalChunks[0], currency),
      margin: fromUnits(marginChunks[0], currency),
      interest: 0,
    },
    schedules: expectedUnits.map((expected, index) => ({
      expectedAmount: fromUnits(expected, currency),
      principal: fromUnits(principalChunks[index + 1], currency),
      margin: fromUnits(marginChunks[index + 1], currency),
      interest: fromUnits(scheduleInterestUnits[index], currency),
    })),
  }
}

export function buildSaleComponentPlan(input: {
  currency: CurrencyCode
  salePrice: number
  costBasisAmount: number
}): ProfitComponents {
  const totalUnits = toUnits(input.salePrice, input.currency)
  const principalUnits = toUnits(input.costBasisAmount, input.currency)
  if (totalUnits <= 0 || principalUnits < 0) throw new Error('Sale component plan is invalid')
  return {
    principal: fromUnits(principalUnits, input.currency),
    margin: fromUnits(totalUnits - principalUnits, input.currency),
    interest: 0,
  }
}

/**
 * Split a partial payment by targeting the component mix at the new cumulative
 * paid percentage. This avoids per-payment rounding drift and makes the final
 * payment absorb every remaining cent/so'm exactly.
 */
export function allocateCumulativePaymentComponents(input: {
  currency: CurrencyCode
  totals: ProfitComponents
  paid: ProfitComponents
  paymentAmount: number
}): { allocation: ProfitComponents; paidAfter: ProfitComponents } {
  const { currency } = input
  const total = {
    principal: toUnits(input.totals.principal, currency),
    margin: toUnits(input.totals.margin, currency),
    interest: toUnits(input.totals.interest, currency),
  }
  const paid = {
    principal: toUnits(input.paid.principal, currency),
    margin: toUnits(input.paid.margin, currency),
    interest: toUnits(input.paid.interest, currency),
  }
  const totalAmount = total.principal + total.margin + total.interest
  const paidAmount = paid.principal + paid.margin + paid.interest
  const paymentAmount = toUnits(input.paymentAmount, currency)
  const paidAfterAmount = paidAmount + paymentAmount

  if (totalAmount <= 0 || paymentAmount <= 0 || paidAmount < 0 || paidAfterAmount > totalAmount) {
    throw new Error('Payment component allocation exceeds the component budget')
  }

  const targetPrincipal = paidAfterAmount === totalAmount
    ? total.principal
    : Math.round(total.principal * (paidAfterAmount / totalAmount))
  const targetInterest = paidAfterAmount === totalAmount
    ? total.interest
    : Math.round(total.interest * (paidAfterAmount / totalAmount))
  // Margin is the balancing component. It may legitimately be negative when a
  // device was sold below cost; keeping it signed preserves the real loss.
  const targetMargin = paidAfterAmount - targetPrincipal - targetInterest
  const paidAfter = {
    principal: targetPrincipal,
    margin: targetMargin,
    interest: targetInterest,
  }
  const allocation = {
    principal: paidAfter.principal - paid.principal,
    margin: paidAfter.margin - paid.margin,
    interest: paidAfter.interest - paid.interest,
  }

  return {
    allocation: {
      principal: fromUnits(allocation.principal, currency),
      margin: fromUnits(allocation.margin, currency),
      interest: fromUnits(allocation.interest, currency),
    },
    paidAfter: {
      principal: fromUnits(paidAfter.principal, currency),
      margin: fromUnits(paidAfter.margin, currency),
      interest: fromUnits(paidAfter.interest, currency),
    },
  }
}

/** Freeze a native component allocation into the actual payment-date UZS row. */
export function splitUzsReportingAmount(input: {
  amountUzs: number
  contractAmount: number
  contractComponents: ProfitComponents
}): ProfitComponents {
  const amountUzs = Math.round(input.amountUzs)
  const contractAmount = Number(input.contractAmount)
  if (amountUzs <= 0 || !Number.isFinite(contractAmount) || contractAmount <= 0) {
    throw new Error('UZS reporting allocation requires positive amounts')
  }
  const principal = Math.round(amountUzs * (input.contractComponents.principal / contractAmount))
  const interest = Math.round(amountUzs * (input.contractComponents.interest / contractAmount))
  const margin = amountUzs - principal - interest
  return { principal, margin, interest }
}

/** Allocate one frozen UZS receipt across native-currency schedule portions. */
export function allocateUzsAcrossContractAmounts(amountUzs: number, contractAmounts: number[]): number[] {
  const roundedUzs = Math.round(amountUzs)
  const weights = contractAmounts.map((amount) => Math.max(0, Math.round(Number(amount) * 100)))
  if (roundedUzs <= 0 || weights.length === 0 || sum(weights) <= 0) {
    throw new Error('UZS schedule allocation requires positive amounts')
  }
  return allocateUnitsByWeight(roundedUzs, weights)
}
