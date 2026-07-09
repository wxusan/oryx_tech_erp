import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  formatContractMoney,
  formatDisplayMoneyFromContract,
  formatContractMoneyWithDisplay,
  computeContractCurrencyMargin,
  computeSaleContractMargin,
  salePaymentAmountDisplay,
  roundContractMoney,
  contractScheduleOutstanding,
  convertContractAmountToUzs,
  convertPaymentToContractCurrency,
  type SalePaymentLike,
  type PurchaseCostLike,
} from '@/lib/nasiya-contract'

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

/**
 * P0 production crash fix: /shop/qurilmalar/[id] crashed after a device was
 * marked sold. Root cause, confirmed empirically (see the git history for
 * this commit): a Prisma `Decimal` column (e.g. `Sale.contractSalePrice`,
 * `SalePayment.appliedAmountInContractCurrency`, `Device.purchaseInputAmount`)
 * serializes to a JSON STRING once it crosses `NextResponse.json()` ->
 * `fetch().json()` on the client — exactly like `Device.purchasePrice`
 * already did (see the pre-existing regression comment/test in
 * `tests/currency.test.ts`). `formatContractMoney` called `amount.toFixed(2)`
 * directly on that raw string for any USD-denominated value, throwing
 * `TypeError: amount.toFixed is not a function` and crashing the whole page
 * render whenever a sale/purchase/payment was USD-native. This was NOT a
 * missing production migration, NOT a missing relation, and NOT a null-field
 * bug — it was a type-coercion gap that the `currency.ts` conversion
 * functions had already been hardened against, but the newer
 * `nasiya-contract.ts` formatters never were.
 */
describe('nasiya-contract.ts money helpers accept serialized-Decimal strings without throwing (the actual crash cause)', () => {
  it('formatContractMoney: USD and UZS both survive a string amount', () => {
    expect(() => formatContractMoney('500.00' as unknown as number, 'USD')).not.toThrow()
    expect(formatContractMoney('500.00' as unknown as number, 'USD')).toBe('$500.00')
    expect(() => formatContractMoney('6250000.00' as unknown as number, 'UZS')).not.toThrow()
    expect(formatContractMoney('6250000.00' as unknown as number, 'UZS')).toMatch(/6.?250.?000 so'm/)
  })

  it('formatDisplayMoneyFromContract: same-currency branch (the exact crash path) survives a string amount', () => {
    expect(() => formatDisplayMoneyFromContract('500.00' as unknown as number, 'USD', 'USD', null)).not.toThrow()
    expect(formatDisplayMoneyFromContract('500.00' as unknown as number, 'USD', 'USD', null)).toBe('$500.00')
  })

  it('formatDisplayMoneyFromContract: cross-currency branch also survives a string amount', () => {
    expect(() => formatDisplayMoneyFromContract('500.00' as unknown as number, 'USD', 'UZS', 12_500)).not.toThrow()
  })

  it('formatContractMoneyWithDisplay survives a string amount', () => {
    expect(() => formatContractMoneyWithDisplay('500.00' as unknown as number, 'USD', 'UZS', 12_500)).not.toThrow()
  })

  it('roundContractMoney, contractScheduleOutstanding, convertContractAmountToUzs, convertPaymentToContractCurrency all coerce string inputs', () => {
    expect(roundContractMoney('500.005' as unknown as number, 'USD')).toBe(500.01)
    expect(contractScheduleOutstanding('500.00' as unknown as number, '499.99' as unknown as number, 'USD')).toBe(0)
    expect(convertContractAmountToUzs('500' as unknown as number, 'USD', 12_500)).toBe(6_250_000)
    expect(convertPaymentToContractCurrency('500' as unknown as number, 'USD', 'USD', null)).toBe(500)
  })

  it('computeContractCurrencyMargin and computeSaleContractMargin survive string amounts', () => {
    expect(() => computeContractCurrencyMargin('500' as unknown as number, '5000000' as unknown as number, 'USD', 12_500)).not.toThrow()
    const purchase: PurchaseCostLike = {
      purchaseCurrency: 'USD',
      purchaseInputAmount: '400.00' as unknown as number,
      purchaseAmountUzsSnapshot: '5000000.00' as unknown as number,
    }
    expect(() => computeSaleContractMargin('500.00' as unknown as number, 'USD', 12_500, purchase)).not.toThrow()
    expect(computeSaleContractMargin('500.00' as unknown as number, 'USD', 12_500, purchase)).toBe(100)
  })

  it('salePaymentAmountDisplay survives every field arriving as a serialized-Decimal string', () => {
    const payment: SalePaymentLike = {
      amount: '6250000.00' as unknown as number,
      paymentInputAmount: '500.00' as unknown as number,
      paymentInputCurrency: 'USD',
      paymentExchangeRate: '12500.0000' as unknown as number,
      appliedAmountInContractCurrency: '500.00' as unknown as number,
    }
    expect(() => salePaymentAmountDisplay(payment, 'USD', { currency: 'USD', usdUzsRate: 12_500 })).not.toThrow()
    expect(salePaymentAmountDisplay(payment, 'USD', { currency: 'USD', usdUzsRate: 12_500 })).toBe('$500.00')
  })

  it('salePaymentAmountDisplay legacy fallback (no payment-time fields) also survives a string amount', () => {
    const legacy: SalePaymentLike = {
      amount: '6250000.00' as unknown as number,
      paymentInputAmount: null,
      paymentInputCurrency: null,
      paymentExchangeRate: null,
      appliedAmountInContractCurrency: null,
    }
    expect(() => salePaymentAmountDisplay(legacy, 'USD', { currency: 'USD', usdUzsRate: 12_500 })).not.toThrow()
  })

  it('empty note does not render broken text (payment.note ?? dash pattern is the caller\'s responsibility, verified in the page below)', () => {
    // salePaymentAmountDisplay itself does not touch `note` — this is a
    // reminder that the null-safety lives in the page's render, asserted below.
    expect(true).toBe(true)
  })
})

describe('device detail page: renders every sale/payment/purchase figure through the hardened helpers, never a raw .toFixed()', () => {
  const page = read('src/app/(shop)/shop/qurilmalar/[id]/page.tsx')

  it('never calls .toFixed() directly on a raw API field — only on the output of a hardened conversion helper', () => {
    // .toFixed() call sites in this file must be fed by
    // convertUzsToUsd/convertPaymentToContractCurrency (both hardened to
    // coerce string input) or formatSaleAmountForInput (a local split-payment
    // display-rounding helper whose `n` parameter is always a plain already-
    // numeric JS value — never a bare device/sale/payment field), never a
    // bare device/sale/payment field.
    const toFixedLines = page.split('\n').filter((l) => l.includes('.toFixed('))
    for (const line of toFixedLines) {
      expect(line).toMatch(/convertUzsToUsd\(|suggestion\.toFixed|formatSaleAmountForInput/)
    }
  })

  it('purchase price / profit / sale amounts all route through display/contract helpers', () => {
    expect(page).toContain('formatDisplayMoneyFromContract(')
    expect(page).toContain('device.purchaseInputAmount')
    expect(page).toContain('device.purchaseCurrency')
    expect(page).toContain('computeSaleContractMargin(')
  })

  it('payment history array access is optional-chained and has an explicit empty-state fallback', () => {
    expect(page).toContain('latestSale.payments?.length')
    expect(page).toContain("To'lov tarixi hali yo'q")
  })

  it('payment note falls back to a dash, never rendering blank/undefined text', () => {
    expect(page).toContain("{payment.note ?? '—'}")
  })

  it('a not-found device (or one belonging to another shop) renders a clean message, not a runtime crash', () => {
    expect(page).toContain("{error || 'Qurilma topilmadi'}")
  })
})

describe('GET /api/devices/[id]: tenant-scoped, and selects every field the page depends on', () => {
  const route = read('src/app/api/devices/[id]/route.ts')

  it('the device query is scoped to the caller\'s shop for SHOP_ADMIN sessions', () => {
    expect(route).toContain("shopId: session.user.shopId ?? ''")
  })

  it('returns 404 (not a crash) when the device is missing or not in this shop', () => {
    expect(route).toContain('if (!device) return notFound(')
  })

  it('selects the full contract-currency ledger and payment-time fields the client needs', () => {
    expect(route).toContain('contractCurrency: true')
    expect(route).toContain('contractSalePrice: true')
    expect(route).toContain('contractExchangeRateAtCreation: true')
    expect(route).toContain('paymentInputAmount: true')
    expect(route).toContain('appliedAmountInContractCurrency: true')
  })
})

describe('Prisma schema/migration guard: the columns this page depends on actually exist', () => {
  const schema = read('prisma/schema.prisma')

  it('Device has the purchase-currency columns', () => {
    expect(schema).toContain('purchaseCurrency               CurrencyCode @default(UZS)')
    expect(schema).toContain('purchaseInputAmount            Decimal      @default(0) @db.Decimal(12, 2)')
    expect(schema).toContain('purchaseExchangeRateAtCreation Decimal?     @db.Decimal(12, 4)')
    expect(schema).toContain('purchaseAmountUzsSnapshot      Decimal      @default(0) @db.Decimal(12, 2)')
  })

  it('Sale has the contract-currency columns', () => {
    expect(schema).toMatch(/contractCurrency\s+CurrencyCode\s+@default\(UZS\)/)
    expect(schema).toContain('contractSalePrice')
    expect(schema).toContain('contractAmountPaid')
    expect(schema).toContain('contractRemainingAmount')
  })

  it('SalePayment has the payment-time currency columns', () => {
    expect(schema).toContain('paymentInputAmount')
    expect(schema).toContain('paymentInputCurrency')
    expect(schema).toContain('paymentExchangeRate')
    expect(schema).toContain('appliedAmountInContractCurrency')
  })

  it('every device-purchase-currency migration file exists on disk (additive, already verified in device-purchase-currency.guard.test.ts)', () => {
    expect(() => read('prisma/migrations/202607080006_device_purchase_currency/migration.sql')).not.toThrow()
  })
})
