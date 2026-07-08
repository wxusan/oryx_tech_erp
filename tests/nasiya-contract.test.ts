import { describe, it, expect } from 'vitest'
import {
  getCompletionToleranceForCurrency,
  getContractCurrency,
  getContractFinalAmount,
  getContractRemainingAmount,
  getContractPaidAmount,
  getScheduleContractExpectedAmount,
  getScheduleContractPaidAmount,
  convertPaymentToContractCurrency,
  formatContractMoney,
  formatDisplayMoneyFromContract,
} from '@/lib/nasiya-contract'

describe('getCompletionToleranceForCurrency', () => {
  it('UZS contracts tolerate 500 so\'m', () => {
    expect(getCompletionToleranceForCurrency('UZS')).toBe(500)
  })
  it('USD contracts tolerate 1 cent, not 500 so\'m', () => {
    expect(getCompletionToleranceForCurrency('USD')).toBe(0.01)
  })
})

describe('contract field readers', () => {
  const nasiya = {
    contractCurrency: 'USD' as const,
    contractFinalAmount: '1000.00',
    contractRemainingAmount: '600.00',
    contractPaidAmount: '400.00',
  }
  it('reads contract currency/final/remaining/paid amounts, coercing Decimal strings', () => {
    expect(getContractCurrency(nasiya)).toBe('USD')
    expect(getContractFinalAmount(nasiya)).toBe(1000)
    expect(getContractRemainingAmount(nasiya)).toBe(600)
    expect(getContractPaidAmount(nasiya)).toBe(400)
  })
  it('reads schedule contract expected/paid amounts', () => {
    const schedule = { contractExpectedAmount: '200.00', contractPaidAmount: '200.00' }
    expect(getScheduleContractExpectedAmount(schedule)).toBe(200)
    expect(getScheduleContractPaidAmount(schedule)).toBe(200)
  })
})

describe('convertPaymentToContractCurrency', () => {
  it('same currency: passes through unchanged, no rate needed', () => {
    expect(convertPaymentToContractCurrency(2_500_000, 'UZS', 'UZS', null)).toBe(2_500_000)
    expect(convertPaymentToContractCurrency(200, 'USD', 'USD', null)).toBe(200)
  })

  it('Example A — USD contract paid in UZS: 2,500,000 so\'m at rate 12,500 -> $200', () => {
    expect(convertPaymentToContractCurrency(2_500_000, 'UZS', 'USD', 12_500)).toBe(200)
  })

  it('Example B — UZS contract paid in USD: $160 at rate 12,500 -> 2,000,000 so\'m', () => {
    expect(convertPaymentToContractCurrency(160, 'USD', 'UZS', 12_500)).toBe(2_000_000)
  })

  it('Example C — USD contract overpayment paid in UZS: 3,125,000 so\'m at rate 12,500 -> $250', () => {
    expect(convertPaymentToContractCurrency(3_125_000, 'UZS', 'USD', 12_500)).toBe(250)
  })

  it('Example D — UZS contract overpayment paid in USD: $200 at rate 12,500 -> 2,500,000 so\'m', () => {
    expect(convertPaymentToContractCurrency(200, 'USD', 'UZS', 12_500)).toBe(2_500_000)
  })

  it('throws when a cross-currency conversion has no rate', () => {
    expect(() => convertPaymentToContractCurrency(100, 'USD', 'UZS', null)).toThrow()
    expect(() => convertPaymentToContractCurrency(100, 'UZS', 'USD', 0)).toThrow()
  })

  it('rounds a UZS->USD conversion to cents', () => {
    // 1,000,000 / 12,000 = 83.3333... -> rounds to 83.33
    expect(convertPaymentToContractCurrency(1_000_000, 'UZS', 'USD', 12_000)).toBe(83.33)
  })
})

describe('formatContractMoney (native, never converts)', () => {
  it('formats USD with $ and 2 decimals', () => {
    expect(formatContractMoney(200, 'USD')).toBe('$200.00')
  })
  it('formats UZS with so\'m suffix, rounded', () => {
    expect(formatContractMoney(2_500_000, 'UZS')).toMatch(/2.?500.?000 so'm/)
  })
})

describe('formatDisplayMoneyFromContract', () => {
  it('same currency: no conversion, just native formatting', () => {
    expect(formatDisplayMoneyFromContract(200, 'USD', 'USD', 13_500)).toBe('$200.00')
  })

  it('USD contract amount shown in UZS display terms using the given (current) rate', () => {
    const text = formatDisplayMoneyFromContract(200, 'USD', 'UZS', 12_500)
    expect(text).toMatch(/2.?500.?000 so'm/)
  })

  it('UZS contract amount shown in USD display terms using the given rate', () => {
    const text = formatDisplayMoneyFromContract(2_000_000, 'UZS', 'USD', 12_500)
    expect(text).toBe('$160.00')
  })

  it('falls back to native formatting with a note when no rate is available', () => {
    const text = formatDisplayMoneyFromContract(200, 'USD', 'UZS', null)
    expect(text).toContain('$200.00')
    expect(text).toContain('kurs mavjud emas')
  })
})
