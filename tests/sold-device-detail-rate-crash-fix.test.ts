import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { convertUsdToUzs, convertUzsToUsd } from '@/lib/currency'
import {
  computeContractCurrencyMargin,
  computeSaleContractMargin,
  formatDisplayMoneyFromContract,
  formatContractMoneyWithDisplay,
  formatContractMoney,
  type PurchaseCostLike,
} from '@/lib/nasiya-contract'

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

/**
 * Continuation of the P0 device-detail crash fix (commit b03fb55 fixed the
 * `.toFixed()` crash in money-FORMATTING helpers, but the page kept
 * crashing after that deploy). Root cause #2, confirmed empirically: every
 * money-formatting helper coerced its `amount` argument via `Number(...)`,
 * but NOT the `rate` argument — and `Sale.contractExchangeRateAtCreation` /
 * `Device.purchaseExchangeRateAtCreation` (both Prisma `Decimal?` columns)
 * are ALSO serialized to JSON strings, exactly like every other Decimal
 * field. `currency.ts`'s `assertRate()` uses the strict, non-coercing
 * `Number.isFinite()` check, which returns `false` for a string even when
 * it represents a perfectly valid rate — throwing "USD kursi noto'g'ri" and
 * crashing the page's profit computation (`computeSaleContractMargin` ->
 * `computeContractCurrencyMargin` -> `convertUzsToUsd(cost,
 * contractExchangeRateAtCreation)`) whenever a device's `purchaseCurrency`
 * differed from its sale's `contractCurrency` — e.g. a device bought in
 * UZS (the common default) and sold in USD. This is the realistic,
 * everyday scenario that kept crashing even after the first fix.
 */
describe('worked example: computeSaleContractMargin crashes on a serialized-Decimal RATE, not just amount', () => {
  it('a device purchased in UZS, sold as a USD contract, crashed profit computation before this fix', () => {
    const purchase: PurchaseCostLike = {
      purchaseCurrency: 'UZS',
      purchaseInputAmount: 5_000_000,
      purchaseAmountUzsSnapshot: 5_000_000,
    }
    // This is exactly the shape `latestSale.contractExchangeRateAtCreation`
    // has once it crosses the API boundary: a string, not a number.
    const rateAsString = '12500.0000' as unknown as number
    expect(() => computeSaleContractMargin(500, 'USD', rateAsString, purchase)).not.toThrow()
    expect(computeSaleContractMargin(500, 'USD', rateAsString, purchase)).toBe(100)
  })

  it('computeContractCurrencyMargin itself: the rate parameter is coerced, not just the two amounts', () => {
    const rateAsString = '12500.0000' as unknown as number
    expect(() => computeContractCurrencyMargin(500, 5_000_000, 'USD', rateAsString)).not.toThrow()
    expect(computeContractCurrencyMargin(500, 5_000_000, 'USD', rateAsString)).toBe(100)
  })
})

describe('currency.ts: convertUsdToUzs/convertUzsToUsd coerce BOTH amount and rate', () => {
  it('accepts a serialized-Decimal rate without throwing "USD kursi noto\'g\'ri"', () => {
    expect(() => convertUsdToUzs(500, '12500.0000' as unknown as number)).not.toThrow()
    expect(convertUsdToUzs(500, '12500.0000' as unknown as number)).toBe(6_250_000)
    expect(() => convertUzsToUsd(6_250_000, '12500.0000' as unknown as number)).not.toThrow()
    expect(convertUzsToUsd(6_250_000, '12500.0000' as unknown as number)).toBe(500)
  })

  it('still rejects a genuinely invalid rate (0, negative, non-numeric string)', () => {
    expect(() => convertUsdToUzs(500, 0)).toThrow()
    expect(() => convertUsdToUzs(500, -1)).toThrow()
    expect(() => convertUsdToUzs(500, 'abc' as unknown as number)).toThrow()
  })
})

describe('formatDisplayMoneyFromContract / formatContractMoneyWithDisplay: rate parameter also coerces', () => {
  it('formatDisplayMoneyFromContract cross-currency branch accepts a serialized-Decimal rate', () => {
    expect(() => formatDisplayMoneyFromContract(500, 'USD', 'UZS', '12500.0000' as unknown as number)).not.toThrow()
    expect(formatDisplayMoneyFromContract(500, 'USD', 'UZS', '12500.0000' as unknown as number)).toMatch(/6.?250.?000 so'm/)
  })

  it('formatContractMoneyWithDisplay accepts a serialized-Decimal rate', () => {
    expect(() => formatContractMoneyWithDisplay(500, 'USD', 'UZS', '12500.0000' as unknown as number)).not.toThrow()
  })
})

describe('invalid/missing amount never crashes — shows "—" instead of "$NaN"/"NaN so\'m"', () => {
  it('formatContractMoney: NaN-producing input returns a dash, not "$NaN"', () => {
    expect(formatContractMoney(undefined as unknown as number, 'USD')).toBe('—')
    expect(formatContractMoney('abc' as unknown as number, 'UZS')).toBe('—')
    // Number(null) is 0 (a legitimate, finite value) — not a bug, so this
    // renders as a real zero amount rather than a dash.
    expect(formatContractMoney(null as unknown as number, 'USD')).toBe('$0.00')
  })

  it('formatDisplayMoneyFromContract: NaN-producing input returns a dash, never throws', () => {
    expect(() => formatDisplayMoneyFromContract(undefined as unknown as number, 'USD', 'UZS', 12_500)).not.toThrow()
    expect(formatDisplayMoneyFromContract(undefined as unknown as number, 'USD', 'UZS', 12_500)).toBe('—')
  })

  it('computeContractCurrencyMargin: NaN-producing input returns null, never throws', () => {
    expect(() => computeContractCurrencyMargin(undefined as unknown as number, 5_000_000, 'USD', 12_500)).not.toThrow()
    expect(computeContractCurrencyMargin(undefined as unknown as number, 5_000_000, 'USD', 12_500)).toBeNull()
  })
})

describe('device detail page: fallback card for a sold device with a missing sale relation', () => {
  const page = read('src/app/(shop)/shop/qurilmalar/[id]/page.tsx')

  it('shows a clear warning instead of silently rendering nothing when a simple-sale device is missing its sale relation', () => {
    expect(page).toContain("['SOLD_CASH', 'SOLD_DEBT'].includes(device.status) && !latestSale && (")
    expect(page).toContain('Bu qurilma sotilgan deb belgilangan, lekin savdo yozuvi topilmadi.')
  })

  it('the sale info card and payment history table both require latestSale to be truthy (never render on missing data)', () => {
    expect(page).toContain("['SOLD_CASH', 'SOLD_DEBT'].includes(device.status) && latestSale && (")
  })
})

describe('existing regression suites still pass after this fix (spot-checked here, full suite run separately)', () => {
  it('computeSaleContractMargin same-currency branch is unaffected (plain subtraction, no rate involved)', () => {
    const purchase: PurchaseCostLike = { purchaseCurrency: 'USD', purchaseInputAmount: 400, purchaseAmountUzsSnapshot: 5_000_000 }
    expect(computeSaleContractMargin(500, 'USD', 12_500, purchase)).toBe(100)
  })

  it('UZS contract margin (no rate needed at all) is unaffected', () => {
    expect(computeContractCurrencyMargin(6_250_000, 5_000_000, 'UZS', null)).toBe(1_250_000)
  })
})
