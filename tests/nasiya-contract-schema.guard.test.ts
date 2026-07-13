import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

describe('Nasiya contract-currency schema is additive, no renames/drops', () => {
  const schema = read('prisma/schema.prisma')
  const nasiyaBlock = schema.slice(schema.indexOf('model Nasiya '), schema.indexOf('model NasiyaSchedule'))
  const scheduleBlock = schema.slice(schema.indexOf('model NasiyaSchedule'), schema.indexOf('model NasiyaDeferral'))
  const paymentBlock = schema.slice(schema.indexOf('model NasiyaPayment'), schema.indexOf('model DeviceReturn'))

  it('Nasiya keeps every legacy UZS field untouched (no rename)', () => {
    for (const field of ['totalAmount', 'downPayment', 'baseRemainingAmount', 'interestAmount', 'finalNasiyaAmount', 'remainingAmount', 'monthlyPayment', 'creationCurrency', 'creationExchangeRate']) {
      expect(nasiyaBlock).toContain(field)
    }
  })

  it('Nasiya has the new contract* fields, contractCurrency NOT NULL with a UZS default', () => {
    expect(nasiyaBlock).toMatch(/contractCurrency\s+CurrencyCode\s+@default\(UZS\)/)
    for (const field of ['contractExchangeRateAtCreation', 'contractTotalAmount', 'contractDownPayment', 'contractBaseRemainingAmount', 'contractInterestAmount', 'contractFinalAmount', 'contractMonthlyPayment', 'contractRemainingAmount', 'contractPaidAmount']) {
      expect(nasiyaBlock).toContain(field)
    }
  })

  it('NasiyaSchedule keeps expectedAmount/paidAmount untouched and adds contract* mirrors', () => {
    expect(scheduleBlock).toContain('expectedAmount')
    expect(scheduleBlock).toContain('paidAmount')
    expect(scheduleBlock).toContain('contractCurrency')
    expect(scheduleBlock).toContain('contractExpectedAmount')
    expect(scheduleBlock).toContain('contractPaidAmount')
    expect(scheduleBlock).toContain('contractRemainingAmount')
  })

  it('NasiyaPayment keeps amount + paymentInput* untouched and adds appliedAmountInContractCurrency only', () => {
    expect(paymentBlock).toContain('amount')
    expect(paymentBlock).toContain('paymentInputAmount')
    expect(paymentBlock).toContain('paymentInputCurrency')
    expect(paymentBlock).toContain('paymentExchangeRate')
    expect(paymentBlock).toContain('appliedAmountInContractCurrency')
  })

  it('the migration is additive only (ADD COLUMN, no DROP/RENAME)', () => {
    const migration = read('prisma/migrations/202607080004_nasiya_contract_currency/migration.sql')
    expect(migration).toContain('ADD COLUMN')
    expect(migration).not.toContain('DROP COLUMN')
    expect(migration).not.toContain('RENAME COLUMN')
  })

  it('the migration backfills existing rows to contractCurrency=UZS from the legacy ledger, never inventing a rate', () => {
    const migration = read('prisma/migrations/202607080004_nasiya_contract_currency/migration.sql')
    expect(migration).toContain("DEFAULT 'UZS'")
    expect(migration).toContain('"contractTotalAmount" = "totalAmount"')
    expect(migration).toContain('"contractFinalAmount" = "finalNasiyaAmount"')
    expect(migration).toContain('"contractRemainingAmount" = "remainingAmount"')
    expect(migration).toContain('"contractExpectedAmount" = "expectedAmount"')
    expect(migration).toContain('"contractPaidAmount" = "paidAmount"')
    expect(migration).toContain('"appliedAmountInContractCurrency" = "amount"')
    expect(migration).not.toContain('contractExchangeRateAtCreation" =')
  })
})
