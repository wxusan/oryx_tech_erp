import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  'prisma/migrations/202607230001_return_currency_refund_method/migration.sql',
  'utf8',
)
const schema = readFileSync('prisma/schema.prisma', 'utf8')
const saleRoute = readFileSync('src/app/api/devices/[id]/return/route.ts', 'utf8')
const nasiyaRoute = readFileSync('src/app/api/nasiya/[id]/return/route.ts', 'utf8')
const nasiyaModal = readFileSync('src/components/shop/nasiya-return-modal.tsx', 'utf8')
const deviceDetail = readFileSync('src/app/(shop)/shop/qurilmalar/[id]/page.tsx', 'utf8')
const returnQueue = readFileSync('src/app/(shop)/shop/qaytarish/return-work-queue.tsx', 'utf8')
const nasiyaDetail = readFileSync('src/app/(shop)/shop/nasiyalar/[id]/page.tsx', 'utf8')
const rangeReport = readFileSync('src/lib/server/shop-report-range.ts', 'utf8')
const customerProfile = readFileSync('src/lib/server/customer-profile.ts', 'utf8')
const customerAnalytics = readFileSync('src/lib/server/customer-profile-analytics.ts', 'utf8')

describe('return currency and refund-method invariants', () => {
  it('keeps original and refund methods separate at both schema and database layers', () => {
    expect(schema).toContain('sourcePaymentMethod PaymentMethod?')
    expect(schema).toContain('refundMethod        PaymentMethod')
    expect(migration).toContain('DROP CONSTRAINT IF EXISTS "ReturnRefundAllocation_same_method_check"')
    expect(migration).toContain('ALTER COLUMN "sourcePaymentMethod" DROP NOT NULL')
    expect(migration).not.toContain('CHECK ("sourcePaymentMethod" = "refundMethod")')
  })

  it('requires the live shop currency and exact FX quote on both return routes', () => {
    for (const route of [saleRoute, nasiyaRoute]) {
      expect(route).toContain('preferredCurrency')
      expect(route).toContain('expectedFxRateMinorUnits')
      expect(route).toContain('currentFxQuote?.rateMinorUnits')
      expect(route).toContain('refundInputCurrency:')
      expect(route).toContain('refundExchangeRateSource:')
      expect(route).toContain('refundExchangeRateFetchedAt:')
    }
  })

  it('makes USD refund provenance mandatory at the database boundary', () => {
    expect(migration).toContain('"refundExchangeRateAtCreation" IS NOT NULL')
    expect(migration).toContain('"refundExchangeRateSource" IS NOT NULL')
    expect(migration).toContain('length(btrim("refundExchangeRateSource")) > 0')
    expect(migration).toContain('"refundExchangeRateFetchedAt" IS NOT NULL')
  })

  it('submits the selected shop currency from every return surface', () => {
    expect(nasiyaModal).toContain('inputCurrency: quote.displayCurrency')
    expect(nasiyaModal).toContain('currency={quote.displayCurrency}')
    expect(nasiyaModal).not.toContain('methodCapacities')
    expect(deviceDetail).toContain('const returnCurrency = currency.currency')
    expect(deviceDetail).toContain('expectedFxRateMinorUnits: currency.fxQuote?.rateMinorUnits ?? null')
    expect(returnQueue).toContain('inputCurrency: currency.currency')
    expect(returnQueue).toContain('expectedFxRateMinorUnits: currency.fxQuote?.rateMinorUnits ?? null')
  })

  it('reads the frozen refund input currency across detail and reporting surfaces', () => {
    expect(nasiyaDetail).toContain('nasiya.returnRecord.refundInput')
    for (const source of [rangeReport, customerProfile, customerAnalytics]) {
      expect(source).toContain('r."refundInputCurrency"')
      expect(source).toContain('r."refundInputAmount"')
    }
  })

  it('preserves signed FX loss instead of capping it or rejecting allocation UZS drift', () => {
    expect(migration).not.toMatch(/"retainedValueAmountUzs"\s*>=\s*0/)
    expect(migration).not.toContain('refund allocation exceeds original receipt')
    expect(saleRoute).toContain('retainedValueAmountUzs: receiptsUzs - refundAmountUzs')
    expect(nasiyaRoute).toContain('retainedValueAmountUzs: receiptsUzs - refundAmountUzs')
    expect(saleRoute).not.toContain('Math.max(0, receiptsUzs - refundAmountUzs)')
  })
})
