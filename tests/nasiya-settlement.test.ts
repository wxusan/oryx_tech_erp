import { describe, expect, it } from 'vitest'
import { calculateNasiyaSettlement } from '@/lib/nasiya-settlement'

function threeOfSix(mode: 'FULL_WITH_PROFIT' | 'WAIVE_REMAINING_PROFIT') {
  return calculateNasiyaSettlement({
    mode,
    contractCurrency: 'UZS',
    contractRemainingAmount: 600,
    contractPaidAmount: 600,
    contractInterestWaivedAmount: 0,
    accountingReconstructionStatus: 'COMPLETE',
    schedules: [1, 2, 3].map((monthNumber) => ({
      id: `schedule-${monthNumber}`,
      monthNumber,
      contractExpectedAmount: 400,
      contractPaidAmount: 200,
      contractRemainingAmount: 200,
      contractInterestWaivedAmount: 0,
      contractPrincipalAmount: 300,
      contractMarginAmount: 50,
      contractInterestAmount: 50,
      contractPrincipalPaidAmount: 150,
      contractMarginPaidAmount: 25,
      contractInterestPaidAmount: 25,
    })),
  })
}

describe('calculateNasiyaSettlement', () => {
  it('collects every remaining unit for Foydasi bilan yopish', () => {
    const quote = threeOfSix('FULL_WITH_PROFIT')

    expect(quote.cashToReceive).toEqual({ currency: 'UZS', minorUnits: 600 })
    expect(quote.interestToWaive).toEqual({ currency: 'UZS', minorUnits: 0 })
    expect(quote.schedules.every((row) => row.status === 'PAID')).toBe(true)
  })

  it('waives only still-unpaid interest and leaves previous interest paid', () => {
    const quote = threeOfSix('WAIVE_REMAINING_PROFIT')

    expect(quote.waiverEligible).toBe(true)
    expect(quote.cashToReceive).toEqual({ currency: 'UZS', minorUnits: 525 })
    expect(quote.interestToWaive).toEqual({ currency: 'UZS', minorUnits: 75 })
    expect(quote.schedules[0]?.cashComponents).toEqual({ principal: 150, margin: 25, interest: 0 })
    expect(quote.schedules[0]?.paidComponentsAfter?.interest).toBe(25)
    expect(quote.schedules.every((row) => row.status === 'SETTLED')).toBe(true)
  })

  it('keeps USD cents exact', () => {
    const quote = calculateNasiyaSettlement({
      mode: 'WAIVE_REMAINING_PROFIT',
      contractCurrency: 'USD',
      contractRemainingAmount: '216.67',
      contractPaidAmount: '123.32',
      accountingReconstructionStatus: 'COMPLETE',
      schedules: [{
        id: 'usd',
        monthNumber: 4,
        contractExpectedAmount: '339.99',
        contractPaidAmount: '123.32',
        contractRemainingAmount: '216.67',
        contractPrincipalAmount: '250.00',
        contractMarginAmount: '39.99',
        contractInterestAmount: '50.00',
        contractPrincipalPaidAmount: '90.80',
        contractMarginPaidAmount: '14.52',
        contractInterestPaidAmount: '18.00',
      }],
    })

    expect(quote.cashToReceive.minorUnits).toBe(18_467)
    expect(quote.interestToWaive.minorUnits).toBe(3_200)
  })

  it('preserves signed margin for a below-cost sale', () => {
    const quote = calculateNasiyaSettlement({
      mode: 'WAIVE_REMAINING_PROFIT',
      contractCurrency: 'UZS',
      contractRemainingAmount: 500,
      contractPaidAmount: 500,
      accountingReconstructionStatus: 'COMPLETE',
      schedules: [{
        id: 'loss',
        monthNumber: 2,
        contractExpectedAmount: 1000,
        contractPaidAmount: 500,
        contractRemainingAmount: 500,
        contractPrincipalAmount: 1000,
        contractMarginAmount: -200,
        contractInterestAmount: 200,
        contractPrincipalPaidAmount: 500,
        contractMarginPaidAmount: -100,
        contractInterestPaidAmount: 100,
      }],
    })

    expect(quote.cashToReceive.minorUnits).toBe(400)
    expect(quote.interestToWaive.minorUnits).toBe(100)
    expect(quote.schedules[0]?.cashComponents).toEqual({ principal: 500, margin: -100, interest: 0 })
  })

  it('does not offer a waiver for zero interest or unreconstructable imports', () => {
    const quote = calculateNasiyaSettlement({
      mode: 'WAIVE_REMAINING_PROFIT',
      contractCurrency: 'UZS',
      contractRemainingAmount: 500,
      contractPaidAmount: 0,
      accountingReconstructionStatus: 'UNRECONSTRUCTABLE',
      schedules: [{
        id: 'import',
        monthNumber: 1,
        contractExpectedAmount: 500,
        contractPaidAmount: 0,
        contractRemainingAmount: 500,
        contractPrincipalAmount: 0,
        contractMarginAmount: 0,
        contractInterestAmount: 0,
        contractPrincipalPaidAmount: 0,
        contractMarginPaidAmount: 0,
        contractInterestPaidAmount: 0,
      }],
    })

    expect(quote.waiverEligible).toBe(false)
    expect(quote.waiverIneligibilityReasons).toContain('Foyda tarkibi ishonchli tiklanmagan')
  })
})
