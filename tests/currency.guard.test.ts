import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8').replace(/\s+/g, ' ')
}

describe('currency source guards', () => {
  it('uses the official CBU USD endpoint with DB cache and OpsEvent fallback logging', () => {
    const src = read('src/lib/server/currency.ts')

    expect(src).toContain('https://cbu.uz/uz/arkhiv-kursov-valyut/json/USD/')
    expect(src).toContain('latestStoredUsdRate()')
    expect(src).toContain("latestStoredUsdRate('CBU')")
    expect(src).toContain("freshness: 'FALLBACK'")
    expect(src).toContain('effectiveAt: latest.effectiveDate')
    expect(src).toContain("source: source ?? { in: ['CBU', 'MANUAL'] }")
    expect(src).toContain('effectiveDate: { not: null }')
    expect(src).toContain('rate: { gte: MIN_USD_UZS_RATE, lte: MAX_USD_UZS_RATE }')
    expect(src).toContain('prisma.currencyRate.create')
    expect(src).toContain('prisma.opsEvent.create')
    expect(src).toContain('currency.rate_fetch_failed')
  })

  it('exposes an audited super-admin manual fallback rate', () => {
    const api = read('src/app/api/admin/currency-rate/route.ts')
    const ui = read('src/app/(admin)/admin/settings/settings-client.tsx')

    expect(api).toContain('requireSuperAdmin()')
    expect(api).toContain("source: 'MANUAL'")
    expect(api).toContain('tx.currencyRate.create')
    expect(api).toContain('tx.log.create')
    expect(api).toContain('isOperationalUsdUzsRate')
    expect(ui).toContain('/api/admin/currency-rate')
    expect(ui).toContain('Qo‘lda kiritilgan oxirgi kurs')
  })

  it('stores currency preference and rates through an additive migration', () => {
    const schema = read('prisma/schema.prisma')
    const migration = read('prisma/migrations/202607040001_currency_toggle_safe_edits_logs/migration.sql')

    expect(schema).toContain('enum CurrencyCode')
    expect(schema).toContain('preferredCurrency CurrencyCode @default(UZS)')
    expect(schema).toContain('model CurrencyRate')
    expect(migration).toContain('CREATE TYPE "CurrencyCode"')
    expect(migration).toContain('ALTER TABLE "Shop" ADD COLUMN "preferredCurrency"')
    expect(migration).toContain('CREATE TABLE "CurrencyRate"')
    expect(migration).not.toMatch(/\bDROP TABLE\b|\bTRUNCATE\b|\bDELETE FROM\b/)
  })

  it('converts money input on the server for core write routes', () => {
    for (const file of [
      'src/app/api/devices/route.ts',
      'src/app/api/devices/[id]/sell/route.ts',
      'src/app/api/devices/[id]/nasiya/route.ts',
      'src/app/api/sales/[id]/payment/route.ts',
      'src/app/api/nasiya/import/route.ts',
    ]) {
      const src = read(file) + (file.endsWith('/nasiya/route.ts') ? read('src/lib/server/nasiya-contract-core.ts') : '')
      expect(src, file).toMatch(/moneyInputToUzs|createMoneyInputConverter/)
      expect(src, file).toContain('moneyInputMeta')
    }

    // Nasiya payments have a stricter source-of-truth boundary: exact money
    // DTOs are created first, then converted once with the frozen quote.
    const nasiyaPaymentRoute = read('src/app/api/nasiya/[id]/payment/route.ts')
    expect(nasiyaPaymentRoute).toContain('createMoneyDto(inputCurrency, amount)')
    expect(nasiyaPaymentRoute).toContain('convertMoneyDto(inputMoney, contractCurrency, conversionQuote)')
    expect(nasiyaPaymentRoute).toContain('createFxQuoteDto({')

    // Returns use exact minor-unit DTO conversion with one route-scoped quote,
    // then preserve the entered currency, rate, and provider provenance.
    const returnRoute = read('src/app/api/devices/[id]/return/route.ts')
    expect(returnRoute).toContain('createMoneyDto(parsed.data.inputCurrency, parsed.data.refundAmount)')
    expect(returnRoute).toContain('convertMoneyDto(refundInputMoney, contractCurrency, currentFxQuote)')
    expect(returnRoute).toContain("convertMoneyDto(refundInputMoney, 'UZS', currentFxQuote)")
    expect(returnRoute).toContain('refundInputAmount: moneyDtoToAmount(refundInputMoney)')
    expect(returnRoute).toContain('refundInputCurrency: settlementCurrency')
    expect(returnRoute).toContain('refundExchangeRateSource:')
    expect(returnRoute).toContain('expectedFxRateMinorUnits')
  })

  it('labels frozen native values, UZS snapshots, and current display values explicitly', () => {
    const src = read('src/app/api/export/[entity]/route.ts')

    expect(src).toContain('purchaseAmountNative')
    expect(src).toContain('purchaseCurrency')
    expect(src).toContain('purchaseExchangeRateAtCreation')
    expect(src).toContain('purchaseAmountUzsSnapshot')
    expect(src).toContain('purchasePriceUzs')
    expect(src).toContain('purchasePriceCurrentShopDisplay')
    expect(src).toContain('contractSalePriceNativeDisplay')
    expect(src).toContain('salePriceUzsSnapshot')
    expect(src).toContain('salePriceCurrentShopDisplay')
    expect(src).toContain('contractFinalAmountNativeDisplay')
    expect(src).toContain('totalAmountUzsSnapshot')
    expect(src).toContain('totalAmountCurrentShopDisplay')
    expect(src).toContain('remainingAmountUzsSnapshot')
    expect(src).toContain('remainingAmountCurrentShopDisplay')
    expect(src).toContain('formatMoneyByCurrency')
  })
})
