import { describe, expect, it } from 'vitest'
import {
  addMoneyDto,
  convertMoneyDto,
  createFxQuoteDto,
  createMoneyDto,
  moneyDtoToAmount,
} from '@/lib/currency'

describe('MoneyDto exact minor-unit contract', () => {
  it('keeps USD cents exact instead of floating-point adding 0.1 + 0.2', () => {
    const total = addMoneyDto(createMoneyDto('USD', '0.10'), createMoneyDto('USD', '0.20'))
    expect(total).toEqual({ currency: 'USD', minorUnits: 30 })
    expect(moneyDtoToAmount(total)).toBe(0.3)
  })

  it("accepts Decimal's harmless trailing zeroes but rejects fractional so'm and sub-cent USD", () => {
    expect(createMoneyDto('UZS', '100.00')).toEqual({ currency: 'UZS', minorUnits: 100 })
    expect(() => createMoneyDto('UZS', '100.01')).toThrow("butun so'mda")
    expect(() => createMoneyDto('USD', '1.234')).toThrow('2 kasr')
  })

  it('never adds unlike currencies without an explicit quote', () => {
    expect(() => addMoneyDto(createMoneyDto('UZS', 1), createMoneyDto('USD', 1))).toThrow('Turli valyutadagi')
  })

  it('uses a fixed four-decimal quote once for a cross-currency conversion', () => {
    const quote = createFxQuoteDto({
      rate: '12500.0000',
      source: 'PAYMENT_TIME',
      effectiveAt: '2026-07-16T00:00:00.000Z',
      fetchedAt: '2026-07-16T00:00:01.000Z',
      freshness: 'FRESH',
    })
    expect(quote.rate).toBe('12500.0000')
    expect(convertMoneyDto(createMoneyDto('USD', '100.00'), 'UZS', quote)).toEqual({
      currency: 'UZS',
      minorUnits: 1_250_000,
    })
  })

  it('requires no quote for a same-currency payment and never invents one for a cross-currency payment', () => {
    const usd = createMoneyDto('USD', '100.00')
    expect(convertMoneyDto(usd, 'USD', null)).toEqual(usd)
    expect(convertMoneyDto(usd, 'UZS', null)).toBeNull()
  })
})
