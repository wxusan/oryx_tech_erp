import { describe, it, expect } from 'vitest'
import { nasiyaPaymentMessage, nasiyaCompletedMessage } from '@/lib/telegram-templates'

const base = {
  shopName: 'Test Shop',
  customerName: 'Ali Valiyev',
  customerPhone: '+998901234567',
  device: { deviceModel: 'iPhone 13', imei: '123456789012345' },
  paymentMethod: 'CASH',
  adminName: 'Admin',
}

describe('nasiyaPaymentMessage — contract-currency allocation breakdown and completion', () => {
  it('Example C — USD display overpayment paid in UZS: payment and allocations show only USD using payment-time rate', () => {
    const msg = nasiyaPaymentMessage({
      ...base,
      month: 'MULTIPLE',
      paidAmount: 250,
      contractCurrency: 'USD',
      remaining: 0,
      currency: { currency: 'USD', usdUzsRate: 12_500 },
      paymentInput: { amount: 3_125_000, currency: 'UZS' },
      paymentExchangeRate: 12_500,
      allocations: [
        { monthNumber: 1, amount: 200 },
        { monthNumber: 2, amount: 50 },
      ],
    })
    expect(msg).toContain('To‘langan: $250.00')
    expect(msg).toContain('$200.00 joriy oy uchun yopildi')
    expect(msg).toContain('$50.00 2-oyga oldindan qo‘llandi')
    expect(msg).not.toContain('so‘m')
    expect(msg).not.toContain('(~')
    expect(msg).not.toContain('Shartnomaga qo‘llandi')
  })

  it('Example D — UZS display overpayment paid in USD: payment and allocations show only UZS using payment-time rate', () => {
    const msg = nasiyaPaymentMessage({
      ...base,
      month: 'MULTIPLE',
      paidAmount: 2_500_000,
      contractCurrency: 'UZS',
      remaining: 0,
      currency: { currency: 'UZS', usdUzsRate: null },
      paymentInput: { amount: 200, currency: 'USD' },
      paymentExchangeRate: 12_500,
      allocations: [
        { monthNumber: 1, amount: 2_000_000 },
        { monthNumber: 2, amount: 500_000 },
      ],
    })
    expect(msg).toMatch(/To‘langan: 2.?500.?000 so‘m/)
    expect(msg).toMatch(/2.?000.?000 so‘m joriy oy uchun yopildi/)
    expect(msg).toMatch(/500.?000 so‘m 2-oyga oldindan qo‘llandi/)
    expect(msg).not.toContain('$')
    expect(msg).not.toContain('(~')
    expect(msg).not.toContain('Shartnomaga qo‘llandi')
  })

  it('shows "To\'liq yopildi" for a fully-cleared contract regardless of currency', () => {
    const msg = nasiyaPaymentMessage({
      ...base,
      month: 1,
      paidAmount: 200,
      contractCurrency: 'USD',
      remaining: 0,
    })
    expect(msg).toContain('Qolgan qarz: To‘liq yopildi')
  })

  it('filters dust allocations so Telegram never shows a fake $0.00 next-month line', () => {
    const msg = nasiyaPaymentMessage({
      ...base,
      month: 'MULTIPLE',
      paidAmount: 36.89,
      contractCurrency: 'USD',
      remaining: 100,
      currency: { currency: 'USD', usdUzsRate: 12_500 },
      allocations: [
        { monthNumber: 1, amount: 36.89 },
        { monthNumber: 2, amount: 0.004 },
      ],
    })

    expect(msg).not.toContain('$0.00')
    expect(msg).not.toContain('2-oyga oldindan')
    expect(msg).not.toContain('To‘lov taqsimoti')
  })
})

describe('nasiyaCompletedMessage — shows the contract-currency total, never a stale UZS-reconversion', () => {
  it('USD contract completed in UZS display: shows only UZS', () => {
    const msg = nasiyaCompletedMessage({
      ...base,
      finalNasiyaAmount: 1000,
      contractCurrency: 'USD',
      currency: { currency: 'UZS', usdUzsRate: 12_500 },
    })
    expect(msg).toMatch(/12.?500.?000 so‘m/)
    expect(msg).not.toContain('$')
  })

  it('UZS contract completed in USD display: shows only USD', () => {
    const msg = nasiyaCompletedMessage({
      ...base,
      finalNasiyaAmount: 12_000_000,
      contractCurrency: 'UZS',
      currency: { currency: 'USD', usdUzsRate: 13_500 },
    })
    expect(msg).toContain('$888.89')
    expect(msg).not.toContain('so‘m')
  })
})
