import { describe, expect, it } from 'vitest'
import {
  deviceAddedMessage,
  deviceRestockedMessage,
  deviceReturnedMessage,
  deviceSoldMessage,
  escapeTelegramHtml,
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
  startShopAdminMessage,
  startSuperAdminMessage,
  startUnknownMessage,
  supplierPayableDueTodayMessage,
  supplierPayableEarlyReminderMessage,
  supplierPayableOverdueMessage,
  supplierPayablePaidMessage,
  telegramIdUnavailableMessage,
  unknownCommandMessage,
} from '@/lib/telegram-templates'

const device = {
  deviceModel: 'iPhone 15 Pro',
  storage: '256 GB',
  color: 'Blue',
  batteryHealth: 95,
  imei: '123456789012345',
}
const dueDate = new Date('2026-07-12T00:00:00.000Z')
const customer = { customerName: 'Ali Valiyev', customerPhone: '+998901234567' }
const supplier = { supplierName: 'Bek Mobile', supplierPhone: '+998909998877' }

const everyMessage = [
  telegramIdUnavailableMessage(),
  startSuperAdminMessage('Abdulloh'),
  startShopAdminMessage('Dilshod', 'Oryx Mobile'),
  startUnknownMessage('123456789'),
  unknownCommandMessage(),
  deviceAddedMessage({ shopName: 'Oryx Mobile', device, purchasePrice: 700, purchaseCurrency: 'USD', adminName: 'Dilshod' }),
  deviceSoldMessage({ shopName: 'Oryx Mobile', device, ...customer, salePrice: 800, paidAmount: 800, remaining: 0, contractCurrency: 'USD', paymentMethod: 'CARD', profit: 100, adminName: 'Dilshod' }),
  deviceReturnedMessage({ shopName: 'Oryx Mobile', device, refundAmount: 100, refundMethod: 'CASH', note: 'Qaytarildi', adminName: 'Dilshod' }),
  deviceRestockedMessage({ shopName: 'Oryx Mobile', device, note: 'Tekshirildi', adminName: 'Dilshod' }),
  nasiyaCreatedMessage({ shopName: 'Oryx Mobile', device, ...customer, totalAmount: 10_000_000, downPayment: 2_000_000, baseRemainingAmount: 8_000_000, interestPercent: 10, interestAmount: 800_000, finalNasiyaAmount: 8_800_000, months: 8, monthlyPayment: 1_100_000, nextPaymentDate: dueDate, adminName: 'Dilshod' }),
  nasiyaPaymentMessage({ shopName: 'Oryx Mobile', device, ...customer, month: 1, paidAmount: 1_100_000, remaining: 7_700_000, contractCurrency: 'UZS', paymentMethod: 'CASH', adminName: 'Dilshod' }),
  nasiyaCompletedMessage({ shopName: 'Oryx Mobile', device, ...customer, finalNasiyaAmount: 8_800_000, contractCurrency: 'UZS', adminName: 'Dilshod' }),
  nasiyaImportedMessage({ shopName: 'Oryx Mobile', device, ...customer, originalTotalAmount: 6_000_000, alreadyPaidBeforeImport: 2_000_000, remainingDebt: 4_000_000, monthlyPayment: 500_000, nextPaymentDate: dueDate, adminName: 'Dilshod' }),
  nasiyaEarlyReminderMessage({ device, ...customer, month: 1, amountDue: 1_100_000, contractCurrency: 'UZS', dueDate, daysLeft: 3 }),
  nasiyaDueTodayMessage({ device, ...customer, month: 1, amountDue: 1_100_000, contractCurrency: 'UZS', dueDate }),
  nasiyaOverdueMessage({ device, ...customer, month: 1, amountDue: 700_000, contractCurrency: 'UZS', dueDate, daysLate: 8 }),
  salePaymentMessage({ shopName: 'Oryx Mobile', device, ...customer, paidAmount: 500_000, remaining: 500_000, contractCurrency: 'UZS', paymentMethod: 'CASH', adminName: 'Dilshod' }),
  saleEarlyReminderMessage({ device, ...customer, remainingAmount: 1_000_000, dueDate, daysLeft: 3 }),
  saleDueTodayMessage({ device, ...customer, remainingAmount: 1_000_000, dueDate }),
  saleOverdueMessage({ device, ...customer, remainingAmount: 1_000_000, dueDate, daysLate: 8 }),
  olibSotdimCreatedMessage({ shopName: 'Oryx Mobile', device, ...customer, ...supplier, purchasePrice: 600, salePrice: 700, profit: 100, contractCurrency: 'USD', supplierPaidNow: false, adminName: 'Dilshod' }),
  supplierPayableEarlyReminderMessage({ device, ...supplier, amount: 600, contractCurrency: 'USD', dueDate, daysLeft: 3 }),
  supplierPayableDueTodayMessage({ device, ...supplier, amount: 600, contractCurrency: 'USD', dueDate }),
  supplierPayableOverdueMessage({ device, ...supplier, amount: 600, contractCurrency: 'USD', dueDate, daysLate: 8 }),
  supplierPayablePaidMessage({ shopName: 'Oryx Mobile', device, ...supplier, amount: 600, contractCurrency: 'USD', paymentMethod: 'TRANSFER', adminName: 'Dilshod' }),
]

describe('Telegram HTML message style', () => {
  it('every one of the 25 messages has exactly one bold title as its first line', () => {
    expect(everyMessage).toHaveLength(25)
    for (const message of everyMessage) {
      expect(message).toMatch(/^<b>[^<\n]+<\/b>/)
      expect(message.match(/<b>/g)).toHaveLength(1)
      expect(message.match(/<\/b>/g)).toHaveLength(1)
    }
  })

  it('escapes every HTML-sensitive character in dynamic values', () => {
    expect(escapeTelegramHtml(`Ali <script>& "test" 'x'`)).toBe(
      'Ali &lt;script&gt;&amp; &quot;test&quot; &#39;x&#39;',
    )

    const message = deviceRestockedMessage({
      shopName: '<Oryx & Co>',
      device: { deviceModel: '<script>alert("x")</script>' },
      note: `Tekshirildi & qayta 'sotuvga'`,
      adminName: 'Ali > Vali',
    })
    expect(message).not.toContain('<script>')
    expect(message).toContain('&lt;Oryx &amp; Co&gt;')
    expect(message).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;')
    expect(message).toContain('Tekshirildi &amp; qayta &#39;sotuvga&#39;')
    expect(message).toContain('Ali &gt; Vali')
  })

  it('renders split payments as a readable bullet list', () => {
    const message = nasiyaPaymentMessage({
      shopName: 'Oryx Mobile',
      device,
      ...customer,
      month: 1,
      paidAmount: 1_000_000,
      remaining: 1_000_000,
      contractCurrency: 'UZS',
      paymentBreakdown: [
        { method: 'CASH', amount: 500_000 },
        { method: 'CARD', amount: 500_000 },
      ],
    })
    expect(message).toContain('💳 To‘lov usuli:\n• Naqd: 500')
    expect(message).toContain('\n• Karta: 500')
  })
})
