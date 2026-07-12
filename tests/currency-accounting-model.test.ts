import { describe, it, expect } from 'vitest'
import {
  paymentAmountDisplay,
  type NasiyaPaymentDisplayRecord as NasiyaPayment,
} from '@/lib/payment-history-display'
import { nasiyaPaymentMessage, salePaymentMessage } from '@/lib/telegram-templates'

function payment(overrides: Partial<NasiyaPayment> = {}): NasiyaPayment {
  return {
    id: 'p1',
    amount: 2_500_000,
    paymentMethod: 'CASH',
    paidAt: '2026-07-08T00:00:00.000Z',
    note: null,
    nasiyaScheduleId: null,
    paymentInputAmount: null,
    paymentInputCurrency: null,
    paymentExchangeRate: null,
    appliedAmountInContractCurrency: null,
    ...overrides,
  }
}

const uzsDisplay = { currency: 'UZS' as const, usdUzsRate: null }
const usdDisplay = { currency: 'USD' as const, usdUzsRate: 13_500 } // deliberately a DIFFERENT rate than payment time

describe('paymentAmountDisplay — historical payment display uses one selected currency with payment-time rate', () => {
  it("USD contract paid in UZS: USD display converts the paid input using the payment-time rate, not today's rate", () => {
    const p = payment({
      amount: 2_500_000,
      paymentInputAmount: 2_500_000,
      paymentInputCurrency: 'UZS',
      paymentExchangeRate: 12_500,
      appliedAmountInContractCurrency: 200,
    })
    const text = paymentAmountDisplay(p, 'USD', usdDisplay)
    expect(text).toBe('$200.00')
    expect(text).not.toMatch(/so'm/)
    expect(text).not.toContain('→')
    expect(text).not.toContain('$185')
  })

  it('USD contract paid in UZS: UZS display shows only the original UZS input', () => {
    const p = payment({
      amount: 2_500_000,
      paymentInputAmount: 2_500_000,
      paymentInputCurrency: 'UZS',
      paymentExchangeRate: 12_500,
      appliedAmountInContractCurrency: 200,
    })
    const text = paymentAmountDisplay(p, 'USD', uzsDisplay)
    expect(text).toMatch(/2.?500.?000 so'm/)
    expect(text).not.toContain('$')
    expect(text).not.toContain('→')
  })

  it('UZS contract paid in USD: UZS display converts the paid input using the payment-time rate', () => {
    const p = payment({
      amount: 2_000_000,
      paymentInputAmount: 160,
      paymentInputCurrency: 'USD',
      paymentExchangeRate: 12_500,
      appliedAmountInContractCurrency: 2_000_000,
    })
    const text = paymentAmountDisplay(p, 'UZS', uzsDisplay)
    expect(text).toMatch(/2.?000.?000 so'm/)
    expect(text).not.toContain('$')
    expect(text).not.toContain('kurs')
    // Must NOT contain today's (different) rate or a recomputed dollar figure.
    expect(text).not.toMatch(/13.?500/)
    expect(text).not.toContain('$185')
  })

  it('USD input shown in USD display remains the original USD amount', () => {
    const p = payment({
      amount: 2_500_000,
      paymentInputAmount: 200,
      paymentInputCurrency: 'USD',
      paymentExchangeRate: 12_500,
      appliedAmountInContractCurrency: 2_500_000,
    })
    expect(paymentAmountDisplay(p, 'UZS', usdDisplay)).toBe('$200.00')
  })

  it('falls back to the live display currency only for legacy payments with no payment-time data (paymentInputCurrency null)', () => {
    const legacy = payment({ amount: 2_500_000 })
    expect(paymentAmountDisplay(legacy, 'UZS', uzsDisplay)).toMatch(/2.?500.?000 so'm/)
    expect(paymentAmountDisplay(legacy, 'UZS', usdDisplay)).toContain('$')
  })

  it('a UZS-native payment on a UZS contract (no conversion) never shows a dollar sign or a rate', () => {
    const p = payment({
      amount: 500_000,
      paymentInputAmount: 500_000,
      paymentInputCurrency: 'UZS',
      appliedAmountInContractCurrency: 500_000,
    })
    const text = paymentAmountDisplay(p, 'UZS', uzsDisplay)
    expect(text).not.toContain('$')
    expect(text).not.toContain('kurs')
  })

  it('a USD-native payment on a USD contract (no conversion) shows a single native $ figure, no arrow/kurs', () => {
    const p = payment({
      amount: 2_500_000,
      paymentInputAmount: 200,
      paymentInputCurrency: 'USD',
      appliedAmountInContractCurrency: 200,
    })
    const text = paymentAmountDisplay(p, 'USD', usdDisplay)
    expect(text).toBe('$200.00')
    expect(text).not.toContain('kurs')
    expect(text).not.toContain('→')
  })
})

describe('Telegram payment messages show payment-time context, not a recalculated figure', () => {
  const base = {
    shopName: 'Test Shop',
    customerName: 'Ali Valiyev',
    customerPhone: '+998901234567',
    device: { deviceModel: 'iPhone 13', imei: '123456789012345' },
    paymentMethod: 'CASH',
    adminName: 'Admin',
  }

  it('nasiyaPaymentMessage: USD display shows only USD for a UZS input converted at payment time', () => {
    const msg = nasiyaPaymentMessage({
      ...base,
      month: 1,
      paidAmount: 200, // applied to the USD contract, not the UZS amount paid
      contractCurrency: 'USD',
      remaining: 0,
      currency: { currency: 'USD', usdUzsRate: 12_500 },
      paymentInput: { amount: 2_500_000, currency: 'UZS' },
      paymentExchangeRate: 12_500,
    })
    expect(msg).toContain('To‘langan: $200.00')
    expect(msg).not.toContain('Shartnomaga qo‘llandi:')
    expect(msg).not.toContain('so‘m')
    expect(msg).not.toContain('(~')
  })

  it('nasiyaPaymentMessage: shows a single line when payment currency matches CONTRACT currency (nothing converted), even if display currency differs', () => {
    const msg = nasiyaPaymentMessage({
      ...base,
      month: 1,
      paidAmount: 2_500_000,
      contractCurrency: 'UZS',
      remaining: 0,
      currency: { currency: 'UZS', usdUzsRate: null },
      paymentInput: { amount: 2_500_000, currency: 'UZS' },
    })
    expect(msg).not.toContain('Shartnomaga qo‘llandi:')
  })

  it('salePaymentMessage: UZS display shows only UZS for a USD input converted at payment time', () => {
    const msg = salePaymentMessage({
      ...base,
      paidAmount: 2_000_000,
      contractCurrency: 'UZS',
      remaining: 0,
      currency: { currency: 'UZS', usdUzsRate: null },
      paymentInput: { amount: 160, currency: 'USD' },
      paymentExchangeRate: 12_500,
    })
    expect(msg).toMatch(/To‘langan: 2.?000.?000 so‘m/)
    expect(msg).not.toContain('$')
    expect(msg).not.toContain('Shartnomaga qo‘llandi:')
    expect(msg).not.toContain('(~')
  })
})
