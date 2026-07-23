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
  it('due-today: UZS display shows only UZS when the payable is USD-native', () => {
    const msg = supplierPayableDueTodayMessage({
      ...base,
      amount: 200,
      contractCurrency: 'USD',
      dueDate: new Date('2026-07-08'),
      currency: { currency: 'UZS', usdUzsRate: 12_500 },
    })
    expect(msg).toMatch(/2.?500.?000 so‘m/)
    expect(msg).not.toContain('$')
    expect(msg).not.toContain('(~')
  })

  it('overdue: USD display shows only USD when the payable is UZS-native', () => {
    const msg = supplierPayableOverdueMessage({
      ...base,
      amount: 2_000_000,
      contractCurrency: 'UZS',
      dueDate: new Date('2026-07-01'),
      daysLate: 7,
      currency: { currency: 'USD', usdUzsRate: 12_500 },
    })
    expect(msg).toContain('$160.00')
    expect(msg).not.toContain('so‘m')
    expect(msg).not.toContain('(~')
  })

  it('early reminder: missing conversion rate does not leak the native currency', () => {
    const msg = supplierPayableEarlyReminderMessage({
      ...base,
      amount: 300,
      contractCurrency: 'USD',
      dueDate: new Date('2026-07-15'),
      daysLeft: 3,
      currency: { currency: 'UZS', usdUzsRate: null },
    })
    expect(msg).toContain('To‘lov summasi: —')
    expect(msg).not.toContain('$300.00')
  })

  it('paid confirmation: shows the selected display currency only', () => {
    const msg = supplierPayablePaidMessage({
      shopName: 'Test',
      ...base,
      amount: 1000,
      contractCurrency: 'USD',
      paymentMethod: 'CASH',
      currency: { currency: 'UZS', usdUzsRate: 13_500 },
    })
    expect(msg).toMatch(/13.?500.?000 so‘m/)
    expect(msg).not.toContain('$')
  })
})

describe('cron reminders and shared payment ledger read authoritative remaining contract amounts/currency', () => {
  const cron = read('src/app/api/cron/reminders/route.ts')
  const ledger = read('src/lib/server/supplier-payable-payments.ts')

  it('all 3 cron supplier payable reminder call sites use unpaid contractRemainingAmount + contractCurrency', () => {
    const occurrences = cron.split('amount: Number(payable.contractRemainingAmount)').length - 1
    expect(occurrences).toBe(3)
    expect(cron.split('contractCurrency: payable.contractCurrency').length - 1).toBe(3)
    expect(cron).not.toContain('amount: Number(payable.contractAmount)')
  })

  it('keeps partially paid supplier obligations in every reminder phase', () => {
    expect(cron.split("status: { in: ['PENDING', 'PARTIAL', 'OVERDUE'] }").length - 1).toBe(3)
    expect(cron).toContain("status: { in: ['PENDING', 'PARTIAL'] }")
  })

  it("the payment service's confirmation uses the applied native amount and payable contract currency", () => {
    expect(ledger).toContain('amount: appliedContractAmount')
    expect(ledger).toContain('contractCurrency: payable.contractCurrency')
  })
})
