import { describe, expect, it } from 'vitest'
import {
  deviceAddedMessage,
  deviceReturnedMessage,
  deviceSoldMessage,
  nasiyaCompletedMessage,
  nasiyaCreatedMessage,
  nasiyaDueTodayMessage,
  nasiyaEarlyReminderMessage,
  nasiyaImportedMessage,
  nasiyaOverdueMessage,
  nasiyaPaymentMessage,
  olibSotdimCreatedMessage,
  saleDueTodayMessage,
  saleEarlyReminderMessage,
  saleOverdueMessage,
  salePaymentMessage,
  supplierPayableDueTodayMessage,
  supplierPayableEarlyReminderMessage,
  supplierPayableOverdueMessage,
  supplierPayablePaidMessage,
} from '@/lib/telegram-templates'

const device = {
  deviceModel: 'iPhone 14 Pro Max',
  storage: '256GB',
  color: 'Deep Purple',
  imei: '3567891000000003',
}

const customer = {
  customerName: 'Ali Valiyev',
  customerPhone: '+998901234567',
}

const supplier = {
  supplierName: 'Aziz',
  supplierPhone: '+998901112233',
}

const usd = { currency: 'USD' as const, usdUzsRate: 12_500 }
const uzs = { currency: 'UZS' as const, usdUzsRate: 12_500 }
const dueDate = new Date('2026-07-15T00:00:00.000Z')

function expectOnlyUsd(message: string) {
  expect(message).toContain('$')
  expect(message).not.toContain('so‘m')
  expect(message).not.toContain("so'm")
  expect(message).not.toContain('(~')
}

function expectOnlyUzs(message: string) {
  expect(message).toContain('so‘m')
  expect(message).not.toContain('$')
  expect(message).not.toContain('(~')
}

function usdDisplayMessages(): string[] {
  return [
    deviceAddedMessage({
      shopName: 'Oryx',
      device,
      purchasePrice: 6_250_000,
      purchaseCurrency: 'UZS',
      currency: usd,
    }),
    deviceSoldMessage({
      shopName: 'Oryx',
      device,
      ...customer,
      salePrice: 6_250_000,
      paidAmount: 3_125_000,
      remaining: 3_125_000,
      contractCurrency: 'UZS',
      currency: usd,
    }),
    deviceReturnedMessage({
      shopName: 'Oryx',
      device,
      refundAmount: 1_250_000,
      note: 'Test',
      currency: usd,
    }),
    nasiyaCreatedMessage({
      shopName: 'Oryx',
      device,
      ...customer,
      totalAmount: 6_250_000,
      downPayment: 1_250_000,
      baseRemainingAmount: 5_000_000,
      interestPercent: 0,
      interestAmount: 0,
      finalNasiyaAmount: 5_000_000,
      months: 5,
      monthlyPayment: 1_000_000,
      currency: usd,
    }),
    nasiyaPaymentMessage({
      shopName: 'Oryx',
      device,
      ...customer,
      month: 'MULTIPLE',
      paidAmount: 600_238,
      remaining: 4_082_845,
      contractCurrency: 'UZS',
      paymentInput: { amount: 50, currency: 'USD' },
      paymentExchangeRate: 12_004.76,
      allocations: [
        { monthNumber: 1, amount: 3_083 },
        { monthNumber: 2, amount: 520_000 },
        { monthNumber: 3, amount: 77_155 },
      ],
      currency: usd,
    }),
    nasiyaCompletedMessage({
      shopName: 'Oryx',
      device,
      ...customer,
      finalNasiyaAmount: 6_250_000,
      contractCurrency: 'UZS',
      currency: usd,
    }),
    nasiyaImportedMessage({
      shopName: 'Oryx',
      device,
      ...customer,
      originalTotalAmount: 6_250_000,
      alreadyPaidBeforeImport: 1_250_000,
      remainingDebt: 5_000_000,
      monthlyPayment: 1_000_000,
      nextPaymentDate: dueDate,
      currency: usd,
    }),
    nasiyaEarlyReminderMessage({
      device,
      ...customer,
      month: 1,
      amountDue: 1_250_000,
      contractCurrency: 'UZS',
      dueDate,
      daysLeft: 3,
      currency: usd,
    }),
    nasiyaDueTodayMessage({
      device,
      ...customer,
      month: 1,
      amountDue: 1_250_000,
      contractCurrency: 'UZS',
      dueDate,
      currency: usd,
    }),
    nasiyaOverdueMessage({
      device,
      ...customer,
      month: 1,
      amountDue: 1_250_000,
      contractCurrency: 'UZS',
      dueDate,
      daysLate: 2,
      currency: usd,
    }),
    salePaymentMessage({
      shopName: 'Oryx',
      device,
      ...customer,
      paidAmount: 1_250_000,
      remaining: 1_250_000,
      contractCurrency: 'UZS',
      paymentInput: { amount: 100, currency: 'USD' },
      paymentExchangeRate: 12_500,
      currency: usd,
    }),
    saleEarlyReminderMessage({
      device,
      ...customer,
      remainingAmount: 1_250_000,
      dueDate,
      daysLeft: 3,
      currency: usd,
    }),
    saleDueTodayMessage({
      device,
      ...customer,
      remainingAmount: 1_250_000,
      dueDate,
      currency: usd,
    }),
    saleOverdueMessage({
      device,
      ...customer,
      remainingAmount: 1_250_000,
      dueDate,
      daysLate: 2,
      currency: usd,
    }),
    olibSotdimCreatedMessage({
      shopName: 'Oryx',
      device,
      ...customer,
      ...supplier,
      purchasePrice: 6_250_000,
      salePrice: 7_500_000,
      profit: 1_250_000,
      contractCurrency: 'UZS',
      supplierPaidNow: false,
      currency: usd,
    }),
    supplierPayableEarlyReminderMessage({
      device,
      ...supplier,
      amount: 1_250_000,
      contractCurrency: 'UZS',
      dueDate,
      daysLeft: 3,
      currency: usd,
    }),
    supplierPayableDueTodayMessage({
      device,
      ...supplier,
      amount: 1_250_000,
      contractCurrency: 'UZS',
      dueDate,
      currency: usd,
    }),
    supplierPayableOverdueMessage({
      device,
      ...supplier,
      amount: 1_250_000,
      contractCurrency: 'UZS',
      dueDate,
      daysLate: 2,
      currency: usd,
    }),
    supplierPayablePaidMessage({
      shopName: 'Oryx',
      device,
      ...supplier,
      amount: 1_250_000,
      contractCurrency: 'UZS',
      currency: usd,
    }),
  ]
}

function uzsDisplayMessages(): string[] {
  return [
    deviceSoldMessage({
      shopName: 'Oryx',
      device,
      ...customer,
      salePrice: 500,
      paidAmount: 250,
      remaining: 250,
      contractCurrency: 'USD',
      currency: uzs,
    }),
    nasiyaPaymentMessage({
      shopName: 'Oryx',
      device,
      ...customer,
      month: 'MULTIPLE',
      paidAmount: 50,
      remaining: 340.1,
      contractCurrency: 'USD',
      paymentInput: { amount: 600_238, currency: 'UZS' },
      paymentExchangeRate: 12_004.76,
      allocations: [
        { monthNumber: 1, amount: 0.26 },
        { monthNumber: 2, amount: 43.32 },
        { monthNumber: 3, amount: 6.43 },
      ],
      currency: uzs,
    }),
    nasiyaCompletedMessage({
      shopName: 'Oryx',
      device,
      ...customer,
      finalNasiyaAmount: 500,
      contractCurrency: 'USD',
      currency: uzs,
    }),
    nasiyaEarlyReminderMessage({
      device,
      ...customer,
      month: 1,
      amountDue: 100,
      contractCurrency: 'USD',
      dueDate,
      daysLeft: 3,
      currency: uzs,
    }),
    nasiyaDueTodayMessage({
      device,
      ...customer,
      month: 1,
      amountDue: 100,
      contractCurrency: 'USD',
      dueDate,
      currency: uzs,
    }),
    nasiyaOverdueMessage({
      device,
      ...customer,
      month: 1,
      amountDue: 100,
      contractCurrency: 'USD',
      dueDate,
      daysLate: 2,
      currency: uzs,
    }),
    salePaymentMessage({
      shopName: 'Oryx',
      device,
      ...customer,
      paidAmount: 100,
      remaining: 50,
      contractCurrency: 'USD',
      paymentInput: { amount: 1_250_000, currency: 'UZS' },
      paymentExchangeRate: 12_500,
      currency: uzs,
    }),
    olibSotdimCreatedMessage({
      shopName: 'Oryx',
      device,
      ...customer,
      ...supplier,
      purchasePrice: 500,
      salePrice: 600,
      profit: 100,
      contractCurrency: 'USD',
      supplierPaidNow: true,
      currency: uzs,
    }),
    supplierPayablePaidMessage({
      shopName: 'Oryx',
      device,
      ...supplier,
      amount: 100,
      contractCurrency: 'USD',
      currency: uzs,
    }),
  ]
}

describe('Telegram money display uses exactly one shop display currency', () => {
  it('USD display messages never include UZS or approximate secondary amounts', () => {
    for (const message of usdDisplayMessages()) {
      expectOnlyUsd(message)
    }
  })

  it('UZS display messages never include USD or approximate secondary amounts', () => {
    for (const message of uzsDisplayMessages()) {
      expectOnlyUzs(message)
    }
  })
})
