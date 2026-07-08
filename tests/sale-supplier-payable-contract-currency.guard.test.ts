import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

describe('Sale/SalePayment/SupplierPayable contract-currency schema is additive, no renames', () => {
  const schema = read('prisma/schema.prisma')
  const saleBlock = schema.slice(schema.indexOf('model Sale '), schema.indexOf('model SalePayment'))
  const salePaymentBlock = schema.slice(schema.indexOf('model SalePayment'), schema.indexOf('model SupplierPayable'))
  const supplierPayableBlock = schema.slice(schema.indexOf('model SupplierPayable'), schema.indexOf('model Nasiya '))

  it('Sale keeps every legacy field untouched and adds contract* fields', () => {
    for (const field of ['salePrice', 'amountPaid', 'remainingAmount', 'creationCurrency', 'creationExchangeRate']) {
      expect(saleBlock).toContain(field)
    }
    expect(saleBlock).toMatch(/contractCurrency\s+CurrencyCode\s+@default\(UZS\)/)
    expect(saleBlock).toContain('contractSalePrice')
    expect(saleBlock).toContain('contractAmountPaid')
    expect(saleBlock).toContain('contractRemainingAmount')
  })

  it('SalePayment keeps amount + paymentInput* untouched and adds appliedAmountInContractCurrency only', () => {
    expect(salePaymentBlock).toContain('amount')
    expect(salePaymentBlock).toContain('paymentInputAmount')
    expect(salePaymentBlock).toContain('appliedAmountInContractCurrency')
  })

  it('SupplierPayable keeps amount untouched and adds contractCurrency/contractAmount/contractExchangeRateAtCreation', () => {
    expect(supplierPayableBlock).toMatch(/\bamount\s+Decimal\s+@db\.Decimal\(12, 2\)/)
    expect(supplierPayableBlock).toMatch(/contractCurrency\s+CurrencyCode\s+@default\(UZS\)/)
    expect(supplierPayableBlock).toContain('contractAmount')
    expect(supplierPayableBlock).toContain('contractExchangeRateAtCreation')
  })

  it('the migration is additive only (ADD COLUMN, no DROP/RENAME)', () => {
    const migration = read('prisma/migrations/202607080005_sale_supplier_payable_contract_currency/migration.sql')
    expect(migration).toContain('ADD COLUMN')
    expect(migration).not.toContain('DROP COLUMN')
    expect(migration).not.toContain('RENAME COLUMN')
  })

  it('the migration backfills existing rows from the legacy ledger, never inventing a rate', () => {
    const migration = read('prisma/migrations/202607080005_sale_supplier_payable_contract_currency/migration.sql')
    expect(migration).toContain('"contractSalePrice" = "salePrice"')
    expect(migration).toContain('"contractAmountPaid" = "amountPaid"')
    expect(migration).toContain('"contractRemainingAmount" = "remainingAmount"')
    expect(migration).toContain('"appliedAmountInContractCurrency" = "amount"')
    expect(migration).toContain('"contractAmount" = "amount"')
  })
})

describe('sell route stores the native contract-currency ledger', () => {
  const route = read('src/app/api/devices/[id]/sell/route.ts')

  it('computes contractSalePrice/contractAmountPaidInput from the raw input, rounded per-currency', () => {
    expect(route).toContain('const contractSalePrice = roundContractMoney(salePrice, contractCurrency)')
  })

  it('stores contractCurrency + all 3 contract amount fields on Sale, alongside the untouched legacy fields', () => {
    expect(route).toContain('contractCurrency,')
    expect(route).toContain('contractExchangeRateAtCreation: salePriceInput.exchangeRateUsed')
    expect(route).toContain('contractSalePrice,')
    expect(route).toContain('contractAmountPaid: contractPaid')
    expect(route).toContain('contractRemainingAmount: contractRemaining')
    expect(route).toContain('salePrice: salePriceUzs')
  })

  it('stores appliedAmountInContractCurrency on the initial SalePayment', () => {
    expect(route).toContain('appliedAmountInContractCurrency: contractPaid')
  })
})

describe('sale payment route dual-writes the contract-currency ledger', () => {
  const route = read('src/app/api/sales/[id]/payment/route.ts')

  it('computes appliedAmountInContractCurrency once, reusing the payment rate when possible', () => {
    expect(route).toContain('const contractLookup = await prisma.sale.findFirst({ where: { id: saleId, shopId }, select: { contractCurrency: true } })')
    expect(route).toContain('convertPaymentToContractCurrency(')
  })

  it('updates contractAmountPaid/contractRemainingAmount on the sale, and stores appliedAmountInContractCurrency on the payment', () => {
    expect(route).toContain('contractAmountPaid: nextContractAmountPaid')
    expect(route).toContain('contractRemainingAmount: nextContractRemaining')
    expect(route).toContain('appliedAmountInContractCurrency,')
  })

  it('does NOT change the legacy UZS overpayment validation (still the source of truth, kept in lockstep)', () => {
    expect(route).toContain("if (amount > oldRemaining)")
  })
})

describe('olib-sotdim route stores contract currency for both the Sale and the SupplierPayable', () => {
  const route = read('src/app/api/olib-sotdim/route.ts')

  it('fixes the pre-existing gap: olib-sotdim Sale rows now get creationCurrency/creationExchangeRate too', () => {
    expect(route).toContain('creationCurrency: saleInput.inputCurrency')
    expect(route).toContain('creationExchangeRate: saleInput.exchangeRateUsed')
  })

  it('stores contractCurrency/contractSalePrice/contractAmountPaid/contractRemainingAmount on Sale', () => {
    expect(route).toContain('contractSalePrice,')
    expect(route).toContain('contractAmountPaid: contractPaid')
    expect(route).toContain('contractRemainingAmount: contractRemaining')
  })

  it('stores contractCurrency/contractAmount/contractExchangeRateAtCreation on SupplierPayable', () => {
    const idx = route.indexOf('tx.supplierPayable.create')
    const block = route.slice(idx, idx + 700)
    expect(block).toContain('contractCurrency,')
    expect(block).toContain('contractExchangeRateAtCreation: purchaseInput.exchangeRateUsed')
    expect(block).toContain('contractAmount: contractPurchasePrice')
  })
})
