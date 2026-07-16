import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

describe('schema: additive payment/creation currency fields exist', () => {
  const schema = read('prisma/schema.prisma')

  it('Nasiya and Sale have informational creationCurrency/creationExchangeRate', () => {
    const nasiyaBlock = schema.slice(schema.indexOf('model Nasiya '), schema.indexOf('model NasiyaSchedule'))
    const saleBlock = schema.slice(schema.indexOf('model Sale '), schema.indexOf('model SalePayment'))
    for (const block of [nasiyaBlock, saleBlock]) {
      expect(block).toContain('creationCurrency')
      expect(block).toContain('creationExchangeRate')
    }
  })

  it('NasiyaPayment and SalePayment have paymentInputAmount/paymentInputCurrency/paymentExchangeRate', () => {
    const salePaymentBlock = schema.slice(schema.indexOf('model SalePayment'), schema.indexOf('model SupplierPayable'))
    const nasiyaPaymentBlock = schema.slice(schema.indexOf('model NasiyaPayment'), schema.indexOf('model DeviceReturn'))
    expect(salePaymentBlock.length).toBeGreaterThan(0)
    expect(nasiyaPaymentBlock.length).toBeGreaterThan(0)
    for (const block of [salePaymentBlock, nasiyaPaymentBlock]) {
      expect(block).toContain('paymentInputAmount')
      expect(block).toContain('paymentInputCurrency')
      expect(block).toContain('paymentExchangeRate')
    }
    expect(nasiyaPaymentBlock).toContain('paymentExchangeRateSource')
    expect(nasiyaPaymentBlock).toContain('paymentExchangeRateEffectiveAt')
    expect(nasiyaPaymentBlock).toContain('paymentExchangeRateFetchedAt')
  })

  it('the migration is additive only (ADD COLUMN, no drops/renames)', () => {
    const migration = read('prisma/migrations/202607080003_payment_currency_history/migration.sql')
    expect(migration).toContain('ADD COLUMN')
    expect(migration).not.toContain('DROP COLUMN')
    expect(migration).not.toContain('RENAME COLUMN')
  })
})

describe('creation routes persist payment-time currency context (informational)', () => {
  it('nasiya creation stores creationCurrency/creationExchangeRate from the already-computed conversion', () => {
    const route = read('src/app/api/devices/[id]/nasiya/route.ts')
    expect(route).toContain('creationCurrency: totalInput.inputCurrency')
    expect(route).toContain('creationExchangeRate: totalInput.exchangeRateUsed')
  })

  it('sale creation stores creationCurrency/creationExchangeRate from the already-computed conversion', () => {
    const route = read('src/app/api/devices/[id]/sell/route.ts')
    expect(route).toContain('creationCurrency: salePriceInput.inputCurrency')
    expect(route).toContain('creationExchangeRate: salePriceInput.exchangeRateUsed')
  })
})

describe('payment routes persist what the customer actually entered', () => {
  it('nasiya payment stores paymentInputAmount/Currency/ExchangeRate on the NasiyaPayment row itself, not only the audit log', () => {
    const route = read('src/app/api/nasiya/[id]/payment/route.ts')
    expect(route).toContain('paymentInputAmount: amount')
    expect(route).toContain('paymentInputCurrency: amountInput.inputCurrency')
    expect(route).toContain('paymentExchangeRate: paymentTimeRate')
    expect(route).toContain('paymentExchangeRateSource: paymentTimeRateSource')
    expect(route).toContain('paymentExchangeRateEffectiveAt: paymentTimeSnapshot?.effectiveAt ?? null')
    expect(route).toContain('paymentExchangeRateFetchedAt: paymentTimeSnapshot?.fetchedAt ?? null')
  })

  it('sale payment stores paymentInputAmount/Currency/ExchangeRate on the SalePayment row itself', () => {
    const route = read('src/app/api/sales/[id]/payment/route.ts')
    expect(route).toContain('paymentInputAmount: parsed.data.amount')
    expect(route).toContain('paymentInputCurrency: amountInput.inputCurrency')
    expect(route).toContain('paymentExchangeRate: contractRate')
  })

  it('GET /api/nasiya/[id] selects the new payment fields so the detail page can render historical amounts', () => {
    const route = read('src/app/api/nasiya/[id]/route.ts')
    expect(route).toContain('paymentInputAmount: true')
    expect(route).toContain('paymentInputCurrency: true')
    expect(route).toContain('paymentExchangeRate: true')
    expect(route).toContain('paymentExchangeRateSource: true')
    expect(route).toContain('paymentExchangeRateEffectiveAt: true')
    expect(route).toContain('paymentExchangeRateFetchedAt: true')
  })
})

describe('debt/schedule math is schedule-authoritative (regression guard)', () => {
  it('the payment route validates native money against the reconciled schedule ledger, not a parent or legacy UZS cache', () => {
    const route = read('src/app/api/nasiya/[id]/payment/route.ts')
    expect(route).toContain('const currentLedger = reconcileNasiyaLedger({')
    expect(route).toContain('const totalOutstandingContract = currentLedger.remaining')
    expect(route).toContain('appliedMoney.minorUnits > totalOutstandingContract.minorUnits')
    expect(route).toContain('const postPaymentLedger = reconcileNasiyaLedger({')
    expect(route).toContain('contractRemainingToStore = moneyDtoDatabaseAmount(postPaymentLedger.remaining)')

    // The allocator keeps a UZS reporting snapshot for legacy readers, but
    // moves both UZS and contract allocation arithmetic through exact units.
    const allocation = read('src/lib/nasiya-payment-allocation.ts')
    expect(allocation).toContain('remainingPaymentMinorUnits')
    expect(allocation).toContain('remainingContractMinorUnits')
    expect(allocation).toContain('createMoneyDto(contractCurrency, schedule.contractExpectedAmount)')
  })

  it('nasiya-utils.ts schedule/completion helpers are unchanged by this ticket (still UZS-based)', () => {
    const utils = read('src/lib/nasiya-utils.ts')
    expect(utils).toContain('export function scheduleOutstanding(expectedAmount: number, paidAmount: number)')
    expect(utils).toContain('COMPLETION_ROUNDING_TOLERANCE_UZS')
  })
})
