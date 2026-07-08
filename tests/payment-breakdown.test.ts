import { describe, it, expect } from 'vitest'
import {
  validatePaymentBreakdown,
  representativePaymentMethod,
  paymentBreakdownTotal,
} from '@/lib/payment-breakdown'

describe('validatePaymentBreakdown (item 12 — split payment)', () => {
  it('accepts a valid half-cash-half-card split summing exactly to the total', () => {
    expect(
      validatePaymentBreakdown(
        [
          { method: 'CASH', amount: 500_000 },
          { method: 'CARD', amount: 500_000 },
        ],
        1_000_000,
      ),
    ).toBeNull()
  })

  it('rejects a single-part "split" (not actually a split)', () => {
    expect(validatePaymentBreakdown([{ method: 'CASH', amount: 1_000_000 }], 1_000_000)).toMatch(/kamida 2/)
  })

  it('rejects a zero or negative part amount', () => {
    expect(
      validatePaymentBreakdown(
        [
          { method: 'CASH', amount: 0 },
          { method: 'CARD', amount: 1_000_000 },
        ],
        1_000_000,
      ),
    ).toMatch(/musbat summa/)

    expect(
      validatePaymentBreakdown(
        [
          { method: 'CASH', amount: -100 },
          { method: 'CARD', amount: 1_000_100 },
        ],
        1_000_000,
      ),
    ).toMatch(/musbat summa/)
  })

  it('rejects parts that do not sum to the payment total', () => {
    expect(
      validatePaymentBreakdown(
        [
          { method: 'CASH', amount: 400_000 },
          { method: 'CARD', amount: 500_000 },
        ],
        1_000_000,
      ),
    ).toMatch(/yig'indisi/)
  })

  it('tolerates float rounding dust within 0.01', () => {
    expect(
      validatePaymentBreakdown(
        [
          { method: 'CASH', amount: 333.33 },
          { method: 'CARD', amount: 333.34 },
          { method: 'TRANSFER', amount: 333.34 },
        ],
        1000.01,
      ),
    ).toBeNull()
  })

  it('accepts 3+ parts, not just 2', () => {
    expect(
      validatePaymentBreakdown(
        [
          { method: 'CASH', amount: 300_000 },
          { method: 'CARD', amount: 300_000 },
          { method: 'TRANSFER', amount: 400_000 },
        ],
        1_000_000,
      ),
    ).toBeNull()
  })
})

describe('representativePaymentMethod', () => {
  it('returns the shared method when every part uses the same one', () => {
    expect(
      representativePaymentMethod([
        { method: 'CASH', amount: 500 },
        { method: 'CASH', amount: 500 },
      ]),
    ).toBe('CASH')
  })

  it('returns OTHER when the split genuinely mixes methods', () => {
    expect(
      representativePaymentMethod([
        { method: 'CASH', amount: 500 },
        { method: 'CARD', amount: 500 },
      ]),
    ).toBe('OTHER')
  })
})

describe('paymentBreakdownTotal', () => {
  it('sums every part', () => {
    expect(
      paymentBreakdownTotal([
        { method: 'CASH', amount: 500_000 },
        { method: 'CARD', amount: 250_000 },
      ]),
    ).toBe(750_000)
  })
})
