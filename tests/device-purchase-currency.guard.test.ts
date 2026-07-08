import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

/**
 * Device now carries its own native purchase-currency context alongside the
 * legacy UZS `purchasePrice` (kept as an untouched compatibility snapshot,
 * dual-written in lockstep) — see docs/currency-accounting-model.md. These
 * guard tests confirm the additive schema, the creation/edit/olib-sotdim
 * write paths, and the profit/UI read paths all agree.
 */
describe('Device purchase-currency schema (additive, no drops/renames)', () => {
  const schema = read('prisma/schema.prisma')

  it('Device model has the new purchase* fields alongside the untouched legacy purchasePrice', () => {
    expect(schema).toContain('purchasePrice                  Decimal      @db.Decimal(12, 2)')
    expect(schema).toContain('purchaseCurrency               CurrencyCode @default(UZS)')
    expect(schema).toContain('purchaseInputAmount            Decimal      @default(0) @db.Decimal(12, 2)')
    expect(schema).toContain('purchaseExchangeRateAtCreation Decimal?     @db.Decimal(12, 4)')
    expect(schema).toContain('purchaseAmountUzsSnapshot      Decimal      @default(0) @db.Decimal(12, 2)')
  })

  it('the migration is additive-only (ADD COLUMN, no DROP COLUMN/RENAME COLUMN) and backfills existing rows to UZS 1:1', () => {
    const migrationPath = 'prisma/migrations/202607080006_device_purchase_currency/migration.sql'
    expect(existsSync(resolve(process.cwd(), migrationPath))).toBe(true)
    const migration = read(migrationPath)
    expect(migration).not.toMatch(/DROP COLUMN/i)
    expect(migration).not.toMatch(/RENAME COLUMN/i)
    expect(migration).toContain('ADD COLUMN "purchaseCurrency" "CurrencyCode" NOT NULL DEFAULT \'UZS\'')
    expect(migration).toContain('"purchaseInputAmount" = "purchasePrice"')
    expect(migration).toContain('"purchaseAmountUzsSnapshot" = "purchasePrice"')
  })
})

describe('Device creation/edit/olib-sotdim routes populate the purchase-currency fields', () => {
  it('POST /api/devices (new device) stores purchaseCurrency/purchaseInputAmount/purchaseExchangeRateAtCreation/purchaseAmountUzsSnapshot', () => {
    const route = read('src/app/api/devices/route.ts')
    expect(route).toContain('purchaseCurrency: purchaseInput.inputCurrency,')
    expect(route).toContain('purchaseInputAmount: purchasePrice,')
    expect(route).toContain('purchaseExchangeRateAtCreation: purchaseInput.exchangeRateUsed,')
    expect(route).toContain('purchaseAmountUzsSnapshot: purchaseInput.amountUzs,')
  })

  it('PATCH /api/devices/[id] dual-writes the purchase-currency fields whenever purchasePrice is edited', () => {
    const route = read('src/app/api/devices/[id]/route.ts')
    expect(route).toContain('const rawPurchasePriceInput = updateData.purchasePrice')
    expect(route).toContain('purchaseCurrency: purchaseMeta.inputCurrency,')
    expect(route).toContain('purchaseInputAmount: rawPurchasePriceInput,')
    expect(route).toContain('purchaseAmountUzsSnapshot: purchaseMeta.amountUzs,')
  })

  it('olib-sotdim device creation stores the same purchase-currency fields from its own inputCurrency', () => {
    const route = read('src/app/api/olib-sotdim/route.ts')
    expect(route).toContain('purchaseCurrency: purchaseInput.inputCurrency,')
    expect(route).toContain('purchaseInputAmount: d.purchasePrice,')
    expect(route).toContain('purchaseAmountUzsSnapshot: purchasePriceUzs,')
  })

  it('deviceAddedMessage shows the device\'s own native purchase currency, not always UZS', () => {
    const templates = read('src/lib/telegram-templates.ts')
    expect(templates).toContain('purchaseCurrency: CurrencyCode')
    expect(templates).toContain(
      "formatContractMoneyWithDisplay(data.purchasePrice, data.purchaseCurrency, data.currency?.currency ?? 'UZS', data.currency?.usdUzsRate)",
    )
    const route = read('src/app/api/devices/route.ts')
    expect(route).toContain('purchaseCurrency: purchaseInput.inputCurrency,')
  })
})

describe('Sale-margin profit uses computeSaleContractMargin (purchase-currency aware, no double-counted FX)', () => {
  it('shop-lists.ts selects Device purchase-currency fields and builds a PurchaseCostLike for both sale types', () => {
    const lists = read('src/lib/server/shop-lists.ts')
    expect(lists).toContain('purchaseCurrency: true,')
    expect(lists).toContain('purchaseInputAmount: true,')
    expect(lists).toContain('purchaseAmountUzsSnapshot: true,')
    expect(lists).toContain('const purchase: PurchaseCostLike = {')
  })

  it('device detail page computes saleContractProfit from the device\'s own purchase-currency context', () => {
    const page = read('src/app/(shop)/shop/qurilmalar/[id]/page.tsx')
    expect(page).toContain('computeSaleContractMargin(')
    expect(page).toContain('purchaseCurrency: device.purchaseCurrency,')
    expect(page).toContain('purchaseInputAmount: device.purchaseInputAmount,')
    expect(page).toContain('purchaseAmountUzsSnapshot: device.purchaseAmountUzsSnapshot,')
  })
})

describe('Device detail UI: purchase price shows its own native currency, never a live reconversion', () => {
  const page = read('src/app/(shop)/shop/qurilmalar/[id]/page.tsx')

  it('Kelish narxi value uses formatContractMoney with the device\'s own purchaseCurrency', () => {
    expect(page).toContain('value: formatContractMoney(device.purchaseInputAmount, device.purchaseCurrency),')
  })

  it('shows a UZS + rate hint only when the purchase currency is not UZS, using the FROZEN purchase-time rate', () => {
    expect(page).toContain("hint: device.purchaseCurrency !== 'UZS' ? `${formatContractMoney(device.purchaseAmountUzsSnapshot, 'UZS')}${purchaseRateHint}` : null,")
    expect(page).toContain('const purchaseRateHint = device.purchaseExchangeRateAtCreation')
  })
})
