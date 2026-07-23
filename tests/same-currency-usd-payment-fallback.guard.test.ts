import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

const moneyInput = read('src/lib/server/money-input.ts')
const saleRoute = read('src/app/api/sales/[id]/payment/route.ts')
const supplierPayments = read('src/lib/server/supplier-payable-payments.ts')
const migration = read(
  'prisma/migrations/202607230003_usd_uzs_evidence_integrity/migration.sql',
)

function sqlFunction(name: string): string {
  const start = migration.indexOf(`CREATE FUNCTION "${name}"`)
  const end = migration.indexOf('$$;', start)
  expect(start, `${name} must exist`).toBeGreaterThan(-1)
  expect(end, `${name} must terminate`).toBeGreaterThan(start)
  return migration.slice(start, end + 3)
}

describe('USD same-currency payment outage fallback', () => {
  it('never calls the current-rate path when USD tender pays a USD contract', () => {
    const helperStart = moneyInput.indexOf('export async function moneyInputToUzsForContract')
    const helperEnd = moneyInput.indexOf('/** Fetch one rate snapshot', helperStart)
    const helper = moneyInput.slice(helperStart, helperEnd)

    expect(helper).toContain("input.inputCurrency !== 'USD' || input.contractCurrency !== 'USD'")
    expect(helper).toContain('input.currencyContext.fxQuote')
    expect(helper).toContain('input.contractExchangeRateAtCreation')
    expect(helper).toContain("exchangeRateSource: 'UNAVAILABLE_SAME_CURRENCY'")
    expect(helper).toContain('exchangeRateUsed: null')
    expect(helper).not.toContain('getUsdUzsRateSnapshot(')
  })

  it('wires the frozen parent rate into SalePayment and SupplierPayablePayment', () => {
    for (const source of [saleRoute, supplierPayments]) {
      expect(source).toContain('moneyInputToUzsForContract({')
      expect(source).toContain('contractExchangeRateAtCreation: true')
      expect(source).toContain(
        'contractExchangeRateAtCreation: contractLookup.contractExchangeRateAtCreation',
      )
    }
  })

  it('lets PostgreSQL prove the reporting mirror without inventing payment-time FX', () => {
    for (const functionName of [
      'validate_sale_payment_v2_evidence',
      'validate_supplier_payment_v2_evidence',
    ]) {
      const fn = sqlFunction(functionName)
      expect(fn).toContain('"contractExchangeRateAtCreation"')
      expect(fn).toContain(
        `"paymentExchangeRateSource" IS DISTINCT FROM 'UNAVAILABLE_SAME_CURRENCY'`,
      )
      expect(fn).toContain('contract_creation_rate NOT BETWEEN 1000 AND 100000')
      expect(fn).toContain(
        'NEW.amount <> round(NEW."paymentInputAmount" * contract_creation_rate)',
      )
    }

    const sentinelCount = migration.match(
      /"paymentExchangeRateSource" = 'UNAVAILABLE_SAME_CURRENCY'/g,
    )?.length ?? 0
    // SalePayment, NasiyaPayment, and SupplierPayablePayment checks.
    expect(sentinelCount).toBe(3)
  })
})
