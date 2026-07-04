import { describe, expect, it } from 'vitest'
import {
  convertUsdToUzs,
  convertUzsToUsd,
  formatMoneyByCurrency,
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

  it('keeps UZS context when formatting USD display for Telegram/export clarity', () => {
    expect(formatMoneyWithBase(1_520_000, 'USD', 12_500)).toMatch(/\$121\.60 \(~1.?520.?000 so'm\)/)
  })

  it('converts USD input to rounded UZS server-side units', () => {
    expect(convertUsdToUzs(120.5, 12_500)).toBe(1_506_250)
    expect(normalizeMoneyInput(120.5, 'USD', 12_500)).toEqual({
      amountUzs: 1_506_250,
      inputCurrency: 'USD',
      exchangeRateUsed: 12_500,
    })
  })

  it('keeps UZS input unchanged except for rounding', () => {
    expect(normalizeMoneyInput(1_506_250.4, 'UZS', null)).toEqual({
      amountUzs: 1_506_250,
      inputCurrency: 'UZS',
      exchangeRateUsed: null,
    })
  })

  it('blocks USD input when no rate is available', () => {
    expect(() => normalizeMoneyInput(10, 'USD', null)).toThrow('USD kursi mavjud emas')
  })

  it('converts UZS to USD without mutating the base amount', () => {
    expect(convertUzsToUsd(1_250_000, 12_500)).toBe(100)
  })
})
