import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  supplierPayableDueTodayMessage,
  supplierPayableOverdueMessage,
  supplierPayableEarlyReminderMessage,
  supplierPayablePaidMessage,
} from '@/lib/telegram-templates'

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

const base = {
  device: { deviceModel: 'iPhone 13', imei: '123456789012345' },
  supplierName: 'Aziz',
  supplierPhone: '+998901234567',
}

describe('supplier payable Telegram messages read the contract-currency amount, not the legacy UZS snapshot', () => {
  it('due-today: shows the native amount, with a display-currency hint when they differ', () => {
    const msg = supplierPayableDueTodayMessage({
      ...base,
      amount: 200,
      contractCurrency: 'USD',
      dueDate: new Date('2026-07-08'),
      currency: { currency: 'UZS', usdUzsRate: 12_500 },
    })
    expect(msg).toContain('$200.00')
    expect(msg).toMatch(/\(~2.?500.?000 so‘m\)/)
  })

  it('overdue: same native-leads formatting', () => {
    const msg = supplierPayableOverdueMessage({
      ...base,
      amount: 2_000_000,
      contractCurrency: 'UZS',
      dueDate: new Date('2026-07-01'),
      daysLate: 7,
      currency: { currency: 'USD', usdUzsRate: 12_500 },
    })
    expect(msg).toMatch(/2.?000.?000 so‘m/)
    expect(msg).toContain('(~$160.00)')
  })

  it('early reminder: same native-leads formatting', () => {
    const msg = supplierPayableEarlyReminderMessage({
      ...base,
      amount: 300,
      contractCurrency: 'USD',
      dueDate: new Date('2026-07-15'),
      daysLeft: 3,
      currency: { currency: 'UZS', usdUzsRate: null },
    })
    // No rate available client-side -> falls back to just the native figure.
    expect(msg).toContain('$300.00')
  })

  it('paid confirmation: shows the contract-currency total regardless of today\'s rate (same drift fix as nasiyaCompletedMessage)', () => {
    const msg = supplierPayablePaidMessage({
      shopName: 'Test',
      ...base,
      amount: 1000,
      contractCurrency: 'USD',
      paymentMethod: 'CASH',
      currency: { currency: 'UZS', usdUzsRate: 13_500 },
    })
    expect(msg).toContain('$1000.00')
  })
})

describe('cron reminders and olib-sotdim pay route read contractAmount/contractCurrency, not the legacy amount', () => {
  const cron = read('src/app/api/cron/reminders/route.ts')
  const payRoute = read('src/app/api/olib-sotdim/[id]/pay/route.ts')

  it('all 3 cron supplier payable reminder call sites use payable.contractAmount + payable.contractCurrency', () => {
    const occurrences = cron.split('amount: Number(payable.contractAmount)').length - 1
    expect(occurrences).toBe(3)
    expect(cron.split('contractCurrency: payable.contractCurrency').length - 1).toBe(3)
  })

  it('the pay route\'s paid-confirmation message uses payable.contractAmount + payable.contractCurrency', () => {
    expect(payRoute).toContain('amount: Number(payable.contractAmount)')
    expect(payRoute).toContain('contractCurrency: payable.contractCurrency')
  })
})
