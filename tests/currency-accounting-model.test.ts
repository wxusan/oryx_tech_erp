import { describe, it, expect } from 'vitest'
import { paymentAmountDisplay, type NasiyaPayment } from '@/app/(shop)/shop/nasiyalar/[id]/page'
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

describe('paymentAmountDisplay — historical payment display never redisplays at today\'s rate', () => {
  it('USD contract paid in UZS (ticket Example A): shows the exact so\'m paid and the $ applied to the contract, regardless of today\'s rate/display currency', () => {
    const p = payment({
      amount: 2_500_000,
      paymentInputAmount: 2_500_000,
      paymentInputCurrency: 'UZS',
      paymentExchangeRate: 12_500,
      appliedAmountInContractCurrency: 200,
    })
    expect(paymentAmountDisplay(p, 'USD', usdDisplay)).toMatch(/2.?500.?000 so'm/)
    expect(paymentAmountDisplay(p, 'USD', usdDisplay)).toContain('$200.00')
    // Switching display to UZS or changing the rate must not change this at all.
    expect(paymentAmountDisplay(p, 'USD', uzsDisplay)).toBe(paymentAmountDisplay(p, 'USD', usdDisplay))
  })

  it('UZS contract paid in USD (ticket Example B): shows $160.00 applied as 2,000,000 so\'m, at the rate used then (12,500) — never today\'s rate', () => {
    const p = payment({
      amount: 2_000_000,
      paymentInputAmount: 160,
      paymentInputCurrency: 'USD',
      paymentExchangeRate: 12_500,
      appliedAmountInContractCurrency: 2_000_000,
    })
    const text = paymentAmountDisplay(p, 'UZS', uzsDisplay)
    expect(text).toContain('$160.00')
    expect(text).toMatch(/2.?000.?000 so'm/)
    expect(text).toMatch(/12.?500/)
    // Must NOT contain today's (different) rate or a recomputed dollar figure.
    expect(text).not.toMatch(/13.?500/)
    expect(text).not.toContain('$185')
  })

  it('is completely stable across repeated calls / display-currency switches (deterministic, no live reconversion)', () => {
    const p = payment({
      amount: 2_500_000,
      paymentInputAmount: 200,
      paymentInputCurrency: 'USD',
      paymentExchangeRate: 12_500,
      appliedAmountInContractCurrency: 2_500_000,
    })
    const a = paymentAmountDisplay(p, 'UZS', uzsDisplay)
    const b = paymentAmountDisplay(p, 'UZS', usdDisplay)
    expect(a).toBe(b)
    expect(a).toContain('$200.00')
  })

  it('falls back to the live display currency only for legacy payments with no payment-time data (paymentInputCurrency null)', () => {
    const legacy = payment({ amount: 2_500_000 })
    expect(paymentAmountDisplay(legacy, 'UZS', uzsDisplay)).toMatch(/2.?500.?000 so'm/)
    expect(paymentAmountDisplay(legacy, 'UZS', usdDisplay)).toContain('$')
  })

  it('a UZS-native payment on a UZS contract (no conversion) never shows a dollar sign or a rate', () => {
    const p = payment({ amount: 500_000, paymentInputAmount: 500_000, paymentInputCurrency: 'UZS', appliedAmountInContractCurrency: 500_000 })
    const text = paymentAmountDisplay(p, 'UZS', uzsDisplay)
    expect(text).not.toContain('$')
    expect(text).not.toContain('kurs')
  })

  it('a USD-native payment on a USD contract (no conversion) shows a single native $ figure, no arrow/kurs', () => {
    const p = payment({ amount: 2_500_000, paymentInputAmount: 200, paymentInputCurrency: 'USD', appliedAmountInContractCurrency: 200 })
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

  it('nasiyaPaymentMessage: USD contract paid in UZS shows "paid X so\'m -> applied $Y" only when payment currency differs from CONTRACT currency', () => {
    const msg = nasiyaPaymentMessage({
      ...base,
      month: 1,
      paidAmount: 200, // applied to the USD contract, not the UZS amount paid
      contractCurrency: 'USD',
      remaining: 0,
      currency: { currency: 'USD', usdUzsRate: 12_500 },
      paymentInput: { amount: 2_500_000, currency: 'UZS' },
    })
    expect(msg).toContain("Shartnomaga qo‘llandi:")
    expect(msg).toContain('$200.00')
    expect(msg).toMatch(/2.?500.?000 so‘m/)
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
    expect(msg).not.toContain("Shartnomaga qo‘llandi:")
  })

  it('salePaymentMessage: UZS contract paid in USD shows the native $ amount and the applied so\'m amount', () => {
    const msg = salePaymentMessage({
      ...base,
      paidAmount: 2_000_000,
      contractCurrency: 'UZS',
      remaining: 0,
      currency: { currency: 'UZS', usdUzsRate: null },
      paymentInput: { amount: 160, currency: 'USD' },
    })
    expect(msg).toContain('$160.00')
    expect(msg).toContain("Shartnomaga qo‘llandi:")
  })
})
