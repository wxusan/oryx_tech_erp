import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

describe('nasiya import stores the native contract-currency ledger for new imports', () => {
  const route = read('src/app/api/nasiya/import/route.ts')

  it('computes contract fields from the RAW input (not UZS-converted), in the file/form\'s own currency', () => {
    expect(route).toContain('const contractCurrency = originalTotalInput.inputCurrency')
    expect(route).toContain('roundContractMoney(data.originalTotalAmount, contractCurrency)')
    expect(route).toContain('roundContractMoney(data.alreadyPaidBeforeImport, contractCurrency)')
    expect(route).toContain('roundContractMoney(data.remainingDebt, contractCurrency)')
    expect(route).toContain('roundContractMoney(data.monthlyPayment, contractCurrency)')
  })

  it('generates a contract-currency schedule forced to the same instalment count as the legacy schedule', () => {
    expect(route).toContain('contractSchedule = generateImportSchedule(')
    expect(route).toContain('schedule.length,')
  })

  it('stores contractCurrency + all 8 contract fields on the imported Nasiya, alongside the untouched legacy import fields', () => {
    expect(route).toContain('contractCurrency,')
    expect(route).toContain('contractExchangeRateAtCreation: originalTotalInput.exchangeRateUsed')
    for (const field of [
      'contractTotalAmount',
      'contractDownPayment',
      'contractBaseRemainingAmount',
      'contractInterestAmount: 0',
      'contractFinalAmount: contractRemainingDebt',
      'contractMonthlyPayment',
      'contractRemainingAmount: contractRemainingDebt',
      'contractPaidAmount: 0',
    ]) {
      expect(route).toContain(field)
    }
    // Legacy import fields still written exactly as before.
    expect(route).toContain('originalTotalAmount: originalTotalInput.amountUzs')
    expect(route).toContain('alreadyPaidBeforeImport: alreadyPaidInput.amountUzs')
  })

  it('stores contractCurrency + contractExpectedAmount on every NasiyaSchedule row', () => {
    const idx = route.indexOf('tx.nasiyaSchedule.createMany')
    const block = route.slice(idx, idx + 400)
    expect(block).toContain('contractCurrency,')
    expect(block).toContain('contractExpectedAmount: contractSchedule[index].expectedAmount')
  })
})
