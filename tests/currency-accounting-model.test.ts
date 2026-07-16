import { describe, it, expect } from 'vitest'
import {
  paymentAmountDisplay,
  type NasiyaPaymentDisplayRecord as NasiyaPayment,
} from '@/lib/payment-history-display'
import { createFxQuoteDto, createMoneyDto } from '@/lib/currency'
import { nasiyaPaymentMessage, salePaymentMessage } from '@/lib/telegram-templates'

function payment(overrides: Partial<NasiyaPayment> = {}): NasiyaPayment {
  return {
    id: 'p1',
    paymentMethod: 'CASH',
    paidAt: '2026-07-08T00:00:00.000Z',
    note: null,
    nasiyaScheduleId: null,
    recordedUzs: createMoneyDto('UZS', 2_500_000),
    input: null,
    applied: null,
    paymentFxQuote: null,
    ...overrides,
  }
}

describe('paymentAmountDisplay — historical payment display is native-first and frozen', () => {
  it('USD contract paid in UZS keeps the original UZS receipt primary and shows the frozen rate', () => {
    const p = payment({
      recordedUzs: createMoneyDto('UZS', 2_500_000),
      input: createMoneyDto('UZS', 2_500_000),
      applied: createMoneyDto('USD', 200),
      paymentFxQuote: createFxQuoteDto({ rate: '12500.0000', source: 'PAYMENT_FROZEN', freshness: 'FRESH' }),
    })
    const display = paymentAmountDisplay(p)
    expect(display.primary).toMatch(/2.?500.?000 so'm/)
    expect(display.secondary).toContain('Shartnomaga: $200.00')
    expect(display.secondary).toContain('12500.0000')
  })

  it('does not change a historical payment when today’s display currency/rate changes', () => {
    const p = payment({
      input: createMoneyDto('USD', 160),
      applied: createMoneyDto('UZS', 2_000_000),
      paymentFxQuote: createFxQuoteDto({ rate: '12500.0000', source: 'PAYMENT_FROZEN', freshness: 'FRESH' }),
    })
    expect(paymentAmountDisplay(p)).toEqual({
      primary: '$160.00',
      secondary: "Shartnomaga: 2 000 000 so'm · Kurs: 1 USD = 12500.0000 so'm · PAYMENT_FROZEN",
    })
  })

  it('same-currency payment shows one native amount and no fabricated rate', () => {
    const p = payment({
      input: createMoneyDto('USD', 200),
      applied: createMoneyDto('USD', 200),
    })
    expect(paymentAmountDisplay(p)).toEqual({ primary: '$200.00', secondary: null })
  })

  it('legacy payments remain native UZS rather than being recomputed with today’s rate', () => {
    const legacy = payment()
    expect(paymentAmountDisplay(legacy)).toEqual({ primary: "2 500 000 so'm", secondary: null })
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
