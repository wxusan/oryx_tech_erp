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
  it('Example C — USD contract overpayment paid in UZS: allocation breakdown shows native $ amounts', () => {
    const msg = nasiyaPaymentMessage({
      ...base,
      month: 'MULTIPLE',
      paidAmount: 250,
      contractCurrency: 'USD',
      remaining: 0,
      currency: { currency: 'USD', usdUzsRate: 12_500 },
      paymentInput: { amount: 3_125_000, currency: 'UZS' },
      allocations: [
        { monthNumber: 1, amount: 200 },
        { monthNumber: 2, amount: 50 },
      ],
    })
    expect(msg).toContain('$200.00 joriy oy uchun yopildi')
    expect(msg).toContain("$50.00 2-oyga oldindan qo'llandi")
    expect(msg).toContain("Shartnomaga qo'llandi: $250.00")
  })

  it('Example D — UZS contract overpayment paid in USD: allocation breakdown shows native so\'m amounts', () => {
    const msg = nasiyaPaymentMessage({
      ...base,
      month: 'MULTIPLE',
      paidAmount: 2_500_000,
      contractCurrency: 'UZS',
      remaining: 0,
      currency: { currency: 'UZS', usdUzsRate: null },
      paymentInput: { amount: 200, currency: 'USD' },
      allocations: [
        { monthNumber: 1, amount: 2_000_000 },
        { monthNumber: 2, amount: 500_000 },
      ],
    })
    expect(msg).toMatch(/2.?000.?000 so'm joriy oy uchun yopildi/)
    expect(msg).toMatch(/500.?000 so'm 2-oyga oldindan qo'llandi/)
    expect(msg).toContain('To\'langan: $200.00')
    expect(msg).toMatch(/Shartnomaga qo'llandi: 2.?500.?000 so'm/)
  })

  it('shows "To\'liq yopildi" for a fully-cleared contract regardless of currency', () => {
    const msg = nasiyaPaymentMessage({ ...base, month: 1, paidAmount: 200, contractCurrency: 'USD', remaining: 0 })
    expect(msg).toContain("Qolgan qarz: To'liq yopildi")
  })
})

describe('nasiyaCompletedMessage — shows the contract-currency total, never a stale UZS-reconversion', () => {
  it('USD contract completed: shows the native $ total regardless of today\'s rate', () => {
    const msg = nasiyaCompletedMessage({
      ...base,
      finalNasiyaAmount: 1000,
      contractCurrency: 'USD',
      currency: { currency: 'UZS', usdUzsRate: null },
    })
    expect(msg).toContain('$1000.00')
  })

  it('UZS contract completed: shows the native so\'m total', () => {
    const msg = nasiyaCompletedMessage({
      ...base,
      finalNasiyaAmount: 12_000_000,
      contractCurrency: 'UZS',
      currency: { currency: 'USD', usdUzsRate: 13_500 },
    })
    expect(msg).toMatch(/12.?000.?000 so'm/)
  })
})
