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
    expect(src).toContain('return Number(latest.rate)')
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
    expect(ui).toContain('/api/admin/currency-rate')
    expect(ui).toContain('Manual oxirgi')
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
      'src/app/api/nasiya/[id]/payment/route.ts',
      'src/app/api/nasiya/import/route.ts',
      'src/app/api/devices/[id]/return/route.ts',
    ]) {
      const src = read(file)
      expect(src, file).toMatch(/moneyInputToUzs|createMoneyInputConverter/)
      expect(src, file).toContain('moneyInputMeta')
    }
  })

  it('keeps accounting exports with base UZS columns plus display columns', () => {
    const src = read('src/app/api/export/[entity]/route.ts')

    expect(src).toContain('purchasePriceUzs')
    expect(src).toContain('purchasePriceDisplay')
    expect(src).toContain('salePriceUzs')
    expect(src).toContain('salePriceDisplay')
    expect(src).toContain('totalAmountUzs')
    expect(src).toContain('totalAmountDisplay')
    expect(src).toContain('formatMoneyByCurrency')
  })
})
