import { describe, expect, it } from 'vitest'
import {
  convertUsdToUzs,
  convertUzsToUsd,
  formatMoneyByCurrency,
  formatUserFacingMoney,
  formatMoneyWithBase,
  normalizeMoneyInput,
} from '@/lib/currency'

describe('currency helpers', () => {
  it('formats UZS as the base currency', () => {
    expect(formatMoneyByCurrency(1_520_000, 'UZS')).toMatch(/1.?520.?000 so'm/)
  })

  it('formats UZS amounts as USD when a USD rate is present', () => {
    expect(formatMoneyByCurrency(1_520_000, 'USD', 12_500)).toBe('$121.60')
  })

  it('legacy base formatter still exists for internal diagnostics only', () => {
    expect(formatMoneyWithBase(1_520_000, 'USD', 12_500)).toMatch(/\$121\.60 \(~1.?520.?000 so'm\)/)
  })

  it('formats user-facing money in exactly one selected display currency', () => {
    expect(
      formatUserFacingMoney({
        amount: 1_520_000,
        amountCurrency: 'UZS',
        displayCurrency: 'USD',
        rate: 12_500,
      }),
    ).toBe('$121.60')
    expect(
      formatUserFacingMoney({
        amount: 121.6,
        amountCurrency: 'USD',
        displayCurrency: 'UZS',
        rate: 12_500,
      }),
    ).toMatch(/1.?520.?000 so'm/)
    expect(
      formatUserFacingMoney({
        amount: 121.6,
        amountCurrency: 'USD',
        displayCurrency: 'USD',
      }),
    ).toBe('$121.60')
    expect(
      formatUserFacingMoney({
        amount: 1_520_000,
        amountCurrency: 'UZS',
        displayCurrency: 'USD',
        rate: null,
      }),
    ).toBe('—')
  })

  it('converts USD input to rounded UZS server-side units', () => {
    expect(convertUsdToUzs(120.5, 12_500)).toBe(1_506_250)
    expect(normalizeMoneyInput(120.5, 'USD', 12_500)).toEqual({
      amountUzs: 1_506_250,
      inputCurrency: 'USD',
      exchangeRateUsed: 12_500,
    })
  })

  it("keeps whole-so'm UZS input unchanged and rejects fractional UZS", () => {
    expect(normalizeMoneyInput(1_506_250, 'UZS', null)).toEqual({
      amountUzs: 1_506_250,
      inputCurrency: 'UZS',
      exchangeRateUsed: null,
    })
    expect(() => normalizeMoneyInput(1_506_250.4, 'UZS', null)).toThrow("butun so'mda")
  })

  it('blocks USD input when no rate is available', () => {
    expect(() => normalizeMoneyInput(10, 'USD', null)).toThrow('USD kursi mavjud emas')
  })

  it('converts UZS to USD without mutating the base amount', () => {
    expect(convertUzsToUsd(1_250_000, 12_500)).toBe(100)
  })

  // Regression: Prisma Decimal columns (e.g. device.purchasePrice) serialize to
  // a STRING over JSON. Passing that string must convert, not throw — otherwise
  // priceFor()/openEdit() crash the sale/nasiya/device-edit pages in USD mode.
  it('accepts string amounts (serialized Decimal) without throwing', () => {
    expect(convertUzsToUsd('1250000', 12_500)).toBe(100)
    expect(convertUsdToUzs('100', 12_500)).toBe(1_250_000)
    expect(convertUzsToUsd('11800000', 12_500)).toBeCloseTo(944, 0)
  })

  it('still rejects genuinely invalid amounts', () => {
    expect(() => convertUzsToUsd('abc', 12_500)).toThrow()
    expect(() => convertUzsToUsd(-5, 12_500)).toThrow()
  })
})
