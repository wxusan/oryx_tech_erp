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
  contractOutstandingAsUzs,
  convertContractAmountToUzs,
  computeContractCurrencyMargin,
  computeSaleContractMargin,
  salePaymentAmountDisplay,
  type SalePaymentLike,
  type PurchaseCostLike,
} from '@/lib/nasiya-contract'

describe('getCompletionToleranceForCurrency', () => {
  it("UZS contracts tolerate 500 so'm", () => {
    expect(getCompletionToleranceForCurrency('UZS')).toBe(500)
  })
  it("USD contracts tolerate 1 cent, not 500 so'm", () => {
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
    const schedule = {
      contractExpectedAmount: '200.00',
      contractPaidAmount: '200.00',
    }
    expect(getScheduleContractExpectedAmount(schedule)).toBe(200)
    expect(getScheduleContractPaidAmount(schedule)).toBe(200)
  })
})

describe('convertPaymentToContractCurrency', () => {
  it('same currency: passes through unchanged, no rate needed', () => {
    expect(convertPaymentToContractCurrency(2_500_000, 'UZS', 'UZS', null)).toBe(2_500_000)
    expect(convertPaymentToContractCurrency(200, 'USD', 'USD', null)).toBe(200)
  })

  it("Example A — USD contract paid in UZS: 2,500,000 so'm at rate 12,500 -> $200", () => {
    expect(convertPaymentToContractCurrency(2_500_000, 'UZS', 'USD', 12_500)).toBe(200)
  })

  it("Example B — UZS contract paid in USD: $160 at rate 12,500 -> 2,000,000 so'm", () => {
    expect(convertPaymentToContractCurrency(160, 'USD', 'UZS', 12_500)).toBe(2_000_000)
  })

  it("Example C — USD contract overpayment paid in UZS: 3,125,000 so'm at rate 12,500 -> $250", () => {
    expect(convertPaymentToContractCurrency(3_125_000, 'UZS', 'USD', 12_500)).toBe(250)
  })

  it("Example D — UZS contract overpayment paid in USD: $200 at rate 12,500 -> 2,500,000 so'm", () => {
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
  it("formats UZS with so'm suffix, rounded", () => {
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

  it('returns a dash instead of leaking another currency when no rate is available', () => {
    expect(formatDisplayMoneyFromContract(200, 'USD', 'UZS', null)).toBe('—')
  })
})

describe('contractOutstandingAsUzs — report aggregates must convert per-row, never re-derive a summed total', () => {
  it('UZS contract: passes through unchanged, rate irrelevant', () => {
    expect(contractOutstandingAsUzs('2000000', '500000', 'UZS', null)).toBe(1_500_000)
    expect(contractOutstandingAsUzs('2000000', '500000', 'UZS', 13_500)).toBe(1_500_000)
  })

  it("USD contract: converts the native outstanding balance using the GIVEN (today's) rate", () => {
    // $600 remaining, today's rate 13,500 -> 8,100,000 so'm (not whatever the
    // contract's own creation rate happened to be).
    expect(contractOutstandingAsUzs('1000', '400', 'USD', 13_500)).toBe(8_100_000)
  })

  it("demonstrates the exact bug this replaces: summing legacy UZS snapshots then converting the TOTAL drifts from summing each row at today's rate", () => {
    // A USD-native nasiya, $600 remaining, created at rate 12,500 -> legacy
    // UZS snapshot = 7,500,000 (frozen). Today's rate has moved to 13,500.
    const legacySnapshotUzs = 600 * 12_500 // 7,500,000 — what the OLD buggy code would sum directly
    const correctUzsToday = contractOutstandingAsUzs('1000', '400', 'USD', 13_500) // 600 * 13,500 = 8,100,000
    expect(legacySnapshotUzs).not.toBe(correctUzsToday)
    expect(correctUzsToday).toBe(8_100_000)
  })

  it('falls back to the raw contract-currency number when no rate is available (never throws)', () => {
    expect(contractOutstandingAsUzs('1000', '400', 'USD', null)).toBe(600)
  })

  it("snaps to 0 within the currency-aware tolerance (USD cents, not UZS so'm)", () => {
    expect(contractOutstandingAsUzs('1000', '999.99', 'USD', 12_500)).toBe(0)
  })
})

describe('computeContractCurrencyMargin — stable, never inventing a USD purchase price', () => {
  it('UZS contract: plain subtraction, unaffected by any rate', () => {
    expect(computeContractCurrencyMargin(6_250_000, 5_000_000, 'UZS', null)).toBe(1_250_000)
  })

  it('USD contract: converts the UZS-only cost using the FROZEN creation rate, never a later rate', () => {
    // $500 sale, 5,000,000 so'm cost, created at rate 12,500 -> cost = $400 natively -> profit $100.
    expect(computeContractCurrencyMargin(500, 5_000_000, 'USD', 12_500)).toBe(100)
  })

  it("is stable — the same margin regardless of what today's rate happens to be (never passed in)", () => {
    const margin1 = computeContractCurrencyMargin(500, 5_000_000, 'USD', 12_500)
    const margin2 = computeContractCurrencyMargin(500, 5_000_000, 'USD', 12_500)
    expect(margin1).toBe(margin2)
    expect(margin1).toBe(100)
  })

  it('returns null for a USD contract with no creation rate, rather than inventing one', () => {
    expect(computeContractCurrencyMargin(500, 5_000_000, 'USD', null)).toBeNull()
  })

  it('matches dividing the already-frozen legacy UZS profit by the same creation rate (no double conversion)', () => {
    const legacyProfitUzs = 6_250_000 - 5_000_000 // 1,250,000 so'm, frozen
    const nativeMargin = computeContractCurrencyMargin(500, 5_000_000, 'USD', 12_500)
    expect(nativeMargin).toBe(Math.round((legacyProfitUzs / 12_500) * 100) / 100)
  })
})

describe('salePaymentAmountDisplay — Sale payment history shows one display currency using payment-time rate', () => {
  function payment(overrides: Partial<SalePaymentLike> = {}): SalePaymentLike {
    return {
      amount: 6_250_000,
      paymentInputAmount: null,
      paymentInputCurrency: null,
      paymentExchangeRate: null,
      appliedAmountInContractCurrency: null,
      ...overrides,
    }
  }

  const uzsDisplay = { currency: 'UZS' as const, usdUzsRate: null }
  const usdDisplay = { currency: 'USD' as const, usdUzsRate: 13_000 } // deliberately different from the payment-time rate

  it('USD sale paid in UZS: USD display shows only the payment-time USD value', () => {
    const p = payment({
      amount: 6_250_000,
      paymentInputAmount: 6_250_000,
      paymentInputCurrency: 'UZS',
      paymentExchangeRate: 12_500,
      appliedAmountInContractCurrency: 500,
    })
    const text = salePaymentAmountDisplay(p, 'USD', usdDisplay)
    expect(text).toBe('$500.00')
    expect(text).not.toMatch(/so'm/)
    expect(text).not.toContain('kurs')
    expect(text).not.toMatch(/13.?000/)
  })

  it('USD sale paid in UZS: UZS display shows only the original UZS amount', () => {
    const p = payment({
      amount: 6_250_000,
      paymentInputAmount: 6_250_000,
      paymentInputCurrency: 'UZS',
      paymentExchangeRate: 12_500,
      appliedAmountInContractCurrency: 500,
    })
    expect(salePaymentAmountDisplay(p, 'USD', uzsDisplay)).toMatch(/6.?250.?000 so'm/)
    expect(salePaymentAmountDisplay(p, 'USD', uzsDisplay)).not.toContain('$')
  })

  it('UZS sale paid in USD: UZS display converts the paid amount at the payment-time rate', () => {
    const p = payment({
      amount: 6_250_000,
      paymentInputAmount: 500,
      paymentInputCurrency: 'USD',
      paymentExchangeRate: 12_500,
      appliedAmountInContractCurrency: 6_250_000,
    })
    const text = salePaymentAmountDisplay(p, 'UZS', uzsDisplay)
    expect(text).toMatch(/6.?250.?000 so'm/)
    expect(text).not.toContain('$')
    expect(text).not.toContain('kurs')
  })

  it('same currency: single native figure, no arrow or rate', () => {
    const p = payment({
      amount: 500,
      paymentInputAmount: 500,
      paymentInputCurrency: 'USD',
      appliedAmountInContractCurrency: 500,
    })
    const text = salePaymentAmountDisplay(p, 'USD', usdDisplay)
    expect(text).toBe('$500.00')
    expect(text).not.toContain('kurs')
    expect(text).not.toContain('→')
  })

  it("legacy fallback: no payment-time fields -> today's display currency, never an invented rate", () => {
    const legacy = payment({ amount: 6_250_000 })
    expect(salePaymentAmountDisplay(legacy, 'USD', uzsDisplay)).toMatch(/6.?250.?000 so'm/)
    expect(salePaymentAmountDisplay(legacy, 'USD', usdDisplay)).toContain('$')
  })
})

describe('convertContractAmountToUzs', () => {
  it('UZS passes through unchanged, regardless of rate', () => {
    expect(convertContractAmountToUzs(500_000, 'UZS', 12_500)).toBe(500_000)
    expect(convertContractAmountToUzs(500_000, 'UZS', null)).toBe(500_000)
  })

  it('USD converts via the given rate', () => {
    expect(convertContractAmountToUzs(100, 'USD', 12_500)).toBe(1_250_000)
  })

  it('USD with no rate available returns the raw number rather than throwing', () => {
    expect(convertContractAmountToUzs(100, 'USD', null)).toBe(100)
  })
})

describe('computeSaleContractMargin — purchase-currency aware, never double-counts an FX difference', () => {
  function purchase(overrides: Partial<PurchaseCostLike> = {}): PurchaseCostLike {
    return {
      purchaseCurrency: 'UZS',
      purchaseInputAmount: 5_000_000,
      purchaseAmountUzsSnapshot: 5_000_000,
      ...overrides,
    }
  }

  it('same currency (USD sale, USD purchase): plain native subtraction, no FX conversion at all', () => {
    // Bought for $400, sold for $500 -> $100 margin, regardless of what the
    // purchase-time and sale-time rates happened to be.
    const p = purchase({
      purchaseCurrency: 'USD',
      purchaseInputAmount: 400,
      purchaseAmountUzsSnapshot: 5_000_000,
    })
    expect(computeSaleContractMargin(500, 'USD', 12_500, p)).toBe(100)
  })

  it('same currency margin is stable even when purchase-time and sale-time rates would have implied different UZS snapshots', () => {
    // Purchase-time UZS snapshot used a different rate (13,000) than the
    // sale's own creation rate (12,500) — the native-currency result must
    // not depend on either rate at all, unlike a round-trip through UZS.
    const p = purchase({
      purchaseCurrency: 'USD',
      purchaseInputAmount: 400,
      purchaseAmountUzsSnapshot: 5_200_000,
    })
    expect(computeSaleContractMargin(500, 'USD', 12_500, p)).toBe(100)
  })

  it('same currency (UZS sale, UZS purchase): plain native subtraction', () => {
    const p = purchase({
      purchaseCurrency: 'UZS',
      purchaseInputAmount: 5_000_000,
      purchaseAmountUzsSnapshot: 5_000_000,
    })
    expect(computeSaleContractMargin(6_250_000, 'UZS', null, p)).toBe(1_250_000)
  })

  it("different currencies: falls back to converting the purchase UZS snapshot via the SALE's frozen creation rate", () => {
    // Device bought in UZS (5,000,000 so'm), sold as a $500 USD contract
    // created at rate 12,500 -> matches computeContractCurrencyMargin exactly.
    const p = purchase({
      purchaseCurrency: 'UZS',
      purchaseInputAmount: 5_000_000,
      purchaseAmountUzsSnapshot: 5_000_000,
    })
    expect(computeSaleContractMargin(500, 'USD', 12_500, p)).toBe(computeContractCurrencyMargin(500, 5_000_000, 'USD', 12_500))
  })

  it('different currencies, no creation rate on a USD sale: returns null rather than inventing one', () => {
    const p = purchase({
      purchaseCurrency: 'UZS',
      purchaseInputAmount: 5_000_000,
      purchaseAmountUzsSnapshot: 5_000_000,
    })
    expect(computeSaleContractMargin(500, 'USD', null, p)).toBeNull()
  })
})
