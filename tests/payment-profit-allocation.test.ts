import { describe, expect, it } from 'vitest'
import {
  allocateCumulativePaymentComponents,
  buildNasiyaComponentPlan,
  buildSaleComponentPlan,
  splitUzsReportingAmount,
} from '@/lib/payment-profit-allocation'

describe('payment-basis profit component allocation', () => {
  it('splits the $800 cost -> $1,000 sale -> $200 down -> 20% -> 4 month example exactly', () => {
    const plan = buildNasiyaComponentPlan({
      currency: 'USD',
      totalAmount: 1_000,
      downPayment: 200,
      interestAmount: 160,
      costBasisAmount: 800,
      scheduleExpectedAmounts: [240, 240, 240, 240],
    })

    expect(plan.downPayment).toEqual({ principal: 160, margin: 40, interest: 0 })
    expect(plan.schedules).toEqual([
      { expectedAmount: 240, principal: 160, margin: 40, interest: 40 },
      { expectedAmount: 240, principal: 160, margin: 40, interest: 40 },
      { expectedAmount: 240, principal: 160, margin: 40, interest: 40 },
      { expectedAmount: 240, principal: 160, margin: 40, interest: 40 },
    ])
  })

  it('keeps UZS and USD rounding exact and puts the remainder on the final installment', () => {
    const plan = buildNasiyaComponentPlan({
      currency: 'USD',
      totalAmount: 999.99,
      downPayment: 111.11,
      interestAmount: 123.45,
      costBasisAmount: 777.77,
      scheduleExpectedAmounts: [337.44, 337.44, 337.45],
    })

    expect(plan.schedules.reduce((sum, row) => sum + row.expectedAmount, 0)).toBeCloseTo(1_012.33, 2)
    expect(plan.schedules.reduce((sum, row) => sum + row.interest, 0)).toBeCloseTo(123.45, 2)
    expect(plan.downPayment.principal + plan.schedules.reduce((sum, row) => sum + row.principal, 0)).toBeCloseTo(777.77, 2)
    expect(plan.downPayment.margin + plan.schedules.reduce((sum, row) => sum + row.margin, 0)).toBeCloseTo(222.22, 2)
  })

  it('allocates partial payments cumulatively and closes with exact component totals', () => {
    const totals = { principal: 160, margin: 40, interest: 40 }
    const first = allocateCumulativePaymentComponents({
      currency: 'USD',
      totals,
      paid: { principal: 0, margin: 0, interest: 0 },
      paymentAmount: 100,
    })
    const second = allocateCumulativePaymentComponents({
      currency: 'USD',
      totals,
      paid: first.paidAfter,
      paymentAmount: 140,
    })

    expect(first.allocation).toEqual({ principal: 66.67, margin: 16.66, interest: 16.67 })
    expect(second.paidAfter).toEqual(totals)
    expect(first.allocation.interest + second.allocation.interest).toBe(40)
  })

  it('preserves a real negative margin for below-cost sales', () => {
    const totals = buildSaleComponentPlan({ currency: 'UZS', salePrice: 800, costBasisAmount: 1_000 })
    const allocation = allocateCumulativePaymentComponents({
      currency: 'UZS',
      totals,
      paid: { principal: 0, margin: 0, interest: 0 },
      paymentAmount: 400,
    })
    expect(totals).toEqual({ principal: 1_000, margin: -200, interest: 0 })
    expect(allocation.allocation).toEqual({ principal: 500, margin: -100, interest: 0 })
  })

  it('freezes payment-date UZS components without losing a so\'m', () => {
    expect(splitUzsReportingAmount({
      amountUzs: 1_250_003,
      contractAmount: 100,
      contractComponents: { principal: 66.67, margin: 16.66, interest: 16.67 },
    })).toEqual({ principal: 833_377, margin: 208_250, interest: 208_376 })
  })
})
