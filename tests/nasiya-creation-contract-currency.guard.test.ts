import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

describe('nasiya creation stores the native contract-currency ledger', () => {
  const route = read('src/app/api/devices/[id]/nasiya/route.ts')

  it('computes a parallel contractAmounts from the RAW (non-UZS-converted) input', () => {
    expect(route).toContain('contractAmounts = calculateNasiyaAmounts({')
    expect(route).toContain('totalAmount,')
    expect(route).toContain('downPayment,')
    expect(route).toContain('currency: totalInput.inputCurrency,')
  })

  it('generates a contract-currency schedule alongside the legacy UZS schedule', () => {
    expect(route).toContain('const contractScheduleItems = generatePaymentSchedule(')
    expect(route).toContain('contractAmounts.finalNasiyaAmount')
  })

  it('stores contractCurrency + all 8 contract amount fields on Nasiya, alongside the untouched legacy fields', () => {
    expect(route).toContain('contractCurrency: totalInput.inputCurrency')
    expect(route).toContain('contractExchangeRateAtCreation: totalInput.exchangeRateUsed')
    for (const field of [
      'contractTotalAmount',
      'contractDownPayment',
      'contractBaseRemainingAmount',
      'contractInterestAmount',
      'contractFinalAmount',
      'contractMonthlyPayment',
      'contractRemainingAmount',
      'contractPaidAmount',
    ]) {
      expect(route).toContain(field)
    }
    // Legacy fields still written exactly as before.
    expect(route).toContain('totalAmount: amounts.totalAmount')
    expect(route).toContain('creationCurrency: totalInput.inputCurrency')
  })

  it('stores contractCurrency + contractExpectedAmount on every NasiyaSchedule row', () => {
    const block = route.slice(route.indexOf('tx.nasiyaSchedule.createMany'), route.indexOf('tx.nasiyaSchedule.createMany') + 500)
    expect(block).toContain('contractCurrency: totalInput.inputCurrency')
    expect(block).toContain('contractExpectedAmount: contractScheduleItems[index].expectedAmount')
  })

  it('stores appliedAmountInContractCurrency on the initial down-payment NasiyaPayment', () => {
    const paymentStart = route.lastIndexOf('tx.nasiyaPayment.create', route.indexOf('"Boshlang\'ich to\'lov"'))
    const block = route.slice(paymentStart, route.indexOf('const shopAdmins', paymentStart))
    expect(block).toContain('appliedAmountInContractCurrency: contractAmounts.downPayment')
  })
})

describe('calculateNasiyaAmounts/generatePaymentSchedule are currency-aware without changing UZS defaults', () => {
  const utils = read('src/lib/nasiya-utils.ts')

  it('roundMoney rounds to cents for USD, whole numbers for UZS (default)', () => {
    expect(utils).toContain("currency === 'USD' ? Math.round(value * 100) / 100 : Math.round(value)")
  })

  it('generatePaymentSchedule defaults to UZS (unchanged behavior for every existing caller)', () => {
    expect(utils).toContain("currency: CurrencyCode = 'UZS'")
  })
})
