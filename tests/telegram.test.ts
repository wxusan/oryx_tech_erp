import { describe, it, expect } from 'vitest'
import { nextTelegramVerifiedAt, normalizeTelegramId } from '@/lib/telegram-id'
import {
  formatDeviceSpecs,
  formatPaymentMethod,
  cleanNote,
  startSuperAdminMessage,
  startShopAdminMessage,
  startUnknownMessage,
  unknownCommandMessage,
  deviceAddedMessage,
  deviceSoldMessage,
  deviceReturnedMessage,
  deviceRestockedMessage,
  nasiyaCreatedMessage,
  nasiyaImportedMessage,
  nasiyaPaymentMessage,
  nasiyaDueTodayMessage,
  nasiyaOverdueMessage,
  salePaymentMessage,
  saleDueTodayMessage,
  saleOverdueMessage,
} from '@/lib/telegram-templates'

const fullDevice = {
  deviceModel: 'iPhone 15 Pro',
  storage: '256GB',
  color: 'Titanium',
  batteryHealth: 88,
  imei: '123456789012345',
}

describe('normalizeTelegramId', () => {
  it('trims and nullifies empty input', () => {
    expect(normalizeTelegramId('  123  ')).toBe('123')
    expect(normalizeTelegramId('')).toBeNull()
    expect(normalizeTelegramId(null)).toBeNull()
  })
})

describe('nextTelegramVerifiedAt', () => {
  it('keeps verification only when the Telegram ID is unchanged', () => {
    const verifiedAt = new Date('2026-07-03T00:00:00.000Z')

    expect(nextTelegramVerifiedAt('12345', verifiedAt, '12345')).toBe(verifiedAt)
    expect(nextTelegramVerifiedAt('12345', verifiedAt, '99999')).toBeNull()
    expect(nextTelegramVerifiedAt('12345', verifiedAt, null)).toBeNull()
    expect(nextTelegramVerifiedAt(null, null, '12345')).toBeNull()
  })
})

describe('helpers', () => {
  it('formatDeviceSpecs includes battery only when requested and numeric', () => {
    expect(formatDeviceSpecs(fullDevice)).toContain('🔋 Batareya: 88%')
    expect(formatDeviceSpecs(fullDevice, { battery: false })).not.toContain('Batareya')
  })

  it('formatDeviceSpecs omits empty optional lines', () => {
    const lines = formatDeviceSpecs({ deviceModel: 'Redmi', storage: null, color: '', batteryHealth: null, imei: null })
    expect(lines).toEqual(['📱 Qurilma: Redmi'])
  })

  it('formatDeviceSpecs omits internal import placeholder IMEIs', () => {
    const lines = formatDeviceSpecs({ deviceModel: 'Redmi', storage: null, color: null, batteryHealth: null, imei: 'IMPORT-abc' })
    const msg = lines.join('\n')

    expect(msg).not.toContain('IMPORT-')
    expect(msg).not.toContain('IMEI')
  })

  it('formatPaymentMethod maps known values and returns null otherwise', () => {
    expect(formatPaymentMethod('CASH')).toBe('Naqd')
    expect(formatPaymentMethod('TRANSFER')).toBe("O‘tkazma")
    expect(formatPaymentMethod('???')).toBeNull()
    expect(formatPaymentMethod(null)).toBeNull()
  })

  it('cleanNote collapses newlines and nullifies empty', () => {
    expect(cleanNote('  a\n  b ')).toBe('a b')
    expect(cleanNote('')).toBeNull()
  })
})

describe('bot direct replies', () => {
  it('super admin welcome uses the name and mentions super admin', () => {
    const msg = startSuperAdminMessage('Abdulloh')
    expect(msg).toContain('Abdulloh')
    expect(msg).toContain('super admin')
  })

  it('shop admin welcome includes the shop name', () => {
    const msg = startShopAdminMessage('Dilshod', 'Malika Electronics')
    expect(msg).toContain('Dilshod')
    expect(msg).toContain('Malika Electronics')
  })

  it('unknown-user reply tells them to check Telegram ID and never mentions /link', () => {
    const msg = startUnknownMessage('123456789')
    expect(msg).toContain('Telegram ID')
    expect(msg).toContain('Telegram ID: 123456789')
    expect(msg.toLowerCase()).not.toContain('/link')
    expect(msg).not.toContain('KOD')
  })

  it('unknown command points to /start and never mentions /link', () => {
    const msg = unknownCommandMessage()
    expect(msg).toContain('/start')
    expect(msg.toLowerCase()).not.toContain('/link')
  })
})

describe('device messages', () => {
  it('device added includes all specs + purchase price', () => {
    const msg = deviceAddedMessage({
      shopName: 'Malika',
      device: fullDevice,
      purchasePrice: 6_000_000,
      purchaseCurrency: 'UZS',
      supplierPhone: '+998901234567',
      adminName: 'Dilshod',
    })
    expect(msg).toContain('iPhone 15 Pro')
    expect(msg).toContain('Xotira: 256GB')
    expect(msg).toContain('Rang: Titanium')
    expect(msg).toContain('Batareya: 88%')
    expect(msg).toContain('IMEI: 123456789012345')
    expect(msg).toMatch(/Olingan narx: 6.?000.?000 so‘m/)
    expect(msg).toContain('Yetkazib beruvchi: +998901234567')
    expect(msg).toContain('Admin: Dilshod')
  })

  it('device added omits empty optional lines', () => {
    const msg = deviceAddedMessage({
      shopName: 'Malika',
      device: { deviceModel: 'Redmi 12', storage: null, color: null, batteryHealth: null, imei: null },
      purchasePrice: 1_000_000,
      purchaseCurrency: 'UZS',
      supplierPhone: null,
      adminName: null,
    })
    expect(msg).not.toContain('Xotira')
    expect(msg).not.toContain('Rang')
    expect(msg).not.toContain('Batareya')
    expect(msg).not.toContain('IMEI')
    expect(msg).not.toContain('Yetkazib beruvchi')
    expect(msg).not.toContain('Admin:')
  })

  it('device added omits internal import placeholder IMEIs', () => {
    const msg = deviceAddedMessage({
      shopName: 'Malika',
      device: { deviceModel: 'Redmi 12', storage: null, color: null, batteryHealth: null, imei: 'IMPORT-abc' },
      purchasePrice: 1_000_000,
      purchaseCurrency: 'UZS',
      supplierPhone: null,
      adminName: null,
    })

    expect(msg).not.toContain('IMPORT-')
    expect(msg).not.toContain('IMEI')
  })

  it('device sold includes specs, prices, and remaining debt', () => {
    const msg = deviceSoldMessage({
      shopName: 'Malika',
      device: fullDevice,
      customerName: 'Ali',
      customerPhone: '+998900000000',
      salePrice: 8_500_000,
      paidAmount: 5_000_000,
      remaining: 3_500_000,
      contractCurrency: 'UZS',
      paymentMethod: 'CASH',
      adminName: 'Dilshod',
    })
    expect(msg).toContain('Xotira: 256GB')
    expect(msg).toContain('Batareya: 88%')
    expect(msg).toContain('IMEI: 123456789012345')
    expect(msg).toMatch(/Sotilish narxi: 8.?500.?000 so‘m/)
    expect(msg).toMatch(/To‘langan: 5.?000.?000 so‘m/)
    expect(msg).toMatch(/Qolgan qarz: 3.?500.?000 so‘m/)
    expect(msg).toContain("To‘lov usuli: Naqd")
  })

  it('device sold shows Foyda (profit) when provided, omitted when not (item 14)', () => {
    const withProfit = deviceSoldMessage({
      shopName: 'Malika',
      device: fullDevice,
      customerName: 'Ali',
      salePrice: 8_500_000,
      paidAmount: 8_500_000,
      remaining: 0,
      contractCurrency: 'UZS',
      paymentMethod: 'CASH',
      profit: 1_500_000,
    })
    expect(withProfit).toMatch(/Foyda: 1.?500.?000 so‘m/)

    const withoutProfit = deviceSoldMessage({
      shopName: 'Malika',
      device: fullDevice,
      customerName: 'Ali',
      salePrice: 8_500_000,
      paidAmount: 8_500_000,
      remaining: 0,
      contractCurrency: 'UZS',
      paymentMethod: 'CASH',
    })
    expect(withoutProfit).not.toContain('Foyda')
  })

  it('device sold for a UZS contract shows the native so\'m amount with a USD hint when display currency differs', () => {
    const msg = deviceSoldMessage({
      shopName: 'Malika',
      device: fullDevice,
      customerName: 'Ali',
      salePrice: 1_250_000,
      paidAmount: 625_000,
      remaining: 625_000,
      contractCurrency: 'UZS',
      paymentMethod: 'CASH',
      currency: { currency: 'USD', usdUzsRate: 12_500 },
    })

    expect(msg).toMatch(/Sotilish narxi: 1.?250.?000 so‘m \(~\$100\.00\)/)
    expect(msg).toMatch(/To‘langan: 625.?000 so‘m \(~\$50\.00\)/)
    expect(msg).toMatch(/Qolgan qarz: 625.?000 so‘m \(~\$50\.00\)/)
  })

  it("device sold shows Qolgan qarz: Yo‘q when fully paid", () => {
    const msg = deviceSoldMessage({
      shopName: 'Malika',
      device: fullDevice,
      customerName: 'Ali',
      salePrice: 8_500_000,
      paidAmount: 8_500_000,
      remaining: 0,
      contractCurrency: 'UZS',
      paymentMethod: 'CASH',
    })
    expect(msg).toContain("Qolgan qarz: Yo‘q")
  })

  it('device returned shows 0 refund and reason', () => {
    const msg = deviceReturnedMessage({
      shopName: 'Malika',
      device: fullDevice,
      refundAmount: 0,
      refundMethod: null,
      note: 'mijoz bekor qildi',
    })
    expect(msg).toMatch(/Qaytarilgan summa: 0 so‘m/)
    expect(msg).not.toContain('Qaytarish usuli')
    expect(msg).toContain('Izoh: mijoz bekor qildi')
  })

  it('device restocked includes reason', () => {
    const msg = deviceRestockedMessage({ shopName: 'Malika', device: fullDevice, note: "ko'rikdan o'tdi", adminName: 'Dilshod' })
    expect(msg).toContain('Izoh: ko&#39;rikdan o&#39;tdi')
    expect(msg).toContain('Admin: Dilshod')
  })
})

describe('nasiya messages', () => {
  const baseNasiya = {
    shopName: 'Malika',
    customerName: 'Ali',
    customerPhone: '+998900000000',
    device: fullDevice,
    totalAmount: 5_200_000,
    downPayment: 1_500_000,
    baseRemainingAmount: 3_700_000,
    months: 6,
    monthlyPayment: 616_667,
    nextPaymentDate: new Date(2026, 7, 1),
    adminName: 'Dilshod',
  }

  it('0% nasiya omits interest lines', () => {
    const msg = nasiyaCreatedMessage({
      ...baseNasiya,
      interestPercent: 0,
      interestAmount: 0,
      finalNasiyaAmount: 3_700_000,
    })
    expect(msg).not.toContain('Nasiya foizi')
    expect(msg).not.toContain('Foiz summasi')
    expect(msg).toContain('Nasiya jami')
    expect(msg).toContain('Keyingi to‘lov: 01.08.2026')
  })

  it('20% nasiya includes interest percent and amount', () => {
    const msg = nasiyaCreatedMessage({
      ...baseNasiya,
      interestPercent: 20,
      interestAmount: 740_000,
      finalNasiyaAmount: 4_440_000,
    })
    expect(msg).toContain('Nasiya foizi: 20%')
    expect(msg).toMatch(/Foiz summasi: 740.?000 so‘m/)
    expect(msg).toContain('Qolgan qarz')
  })

  it('nasiya payment never shows a raw nasiya id and includes the essentials', () => {
    const msg = nasiyaPaymentMessage({
      shopName: 'Malika',
      customerName: 'Ali',
      customerPhone: '+998900000000',
      device: fullDevice,
      month: 3,
      paidAmount: 1_000_000,
      contractCurrency: 'UZS',
      paymentMethod: 'CARD',
      remaining: 2_000_000,
      note: 'naqd berdi',
      adminName: 'Dilshod',
    })
    expect(msg).not.toMatch(/[a-z0-9]{20,}/) // no cuid-like raw id
    expect(msg).not.toContain('Nasiya:')
    expect(msg).toContain('Mijoz: Ali')
    expect(msg).toContain('Oy: 3-oy')
    expect(msg).toMatch(/To‘langan: 1.?000.?000 so‘m/)
    expect(msg).toContain("To‘lov usuli: Karta")
    expect(msg).toMatch(/Qolgan qarz: 2.?000.?000 so‘m/)
    expect(msg).not.toContain('Batareya')
  })

  it('nasiya payment shows To\'liq yopildi when cleared and Bir nechta oy for multi', () => {
    const cleared = nasiyaPaymentMessage({
      shopName: 'M', customerName: 'A', device: fullDevice, month: 'MULTIPLE',
      paidAmount: 500_000, contractCurrency: 'UZS', paymentMethod: 'CASH', remaining: 0,
    })
    expect(cleared).toContain("Qolgan qarz: To‘liq yopildi")
    expect(cleared).toContain('Oy: Bir nechta oy')
  })

  it('nasiya due reminder includes month, amount and due date', () => {
    const msg = nasiyaDueTodayMessage({
      customerName: 'Ali', customerPhone: '+998900000000', device: fullDevice,
      month: 2, amountDue: 616_667, contractCurrency: 'UZS', dueDate: new Date(2026, 7, 1),
    })
    expect(msg).toContain('Oy: 2-oy')
    expect(msg).toMatch(/To‘lov summasi: 616.?667 so‘m/)
    expect(msg).toContain('Muddat: Bugun')
  })

  it('nasiya overdue includes daysLate', () => {
    const msg = nasiyaOverdueMessage({
      customerName: 'Ali', customerPhone: '+998900000000', device: fullDevice,
      month: 2, amountDue: 616_667, contractCurrency: 'UZS', dueDate: new Date(2026, 6, 1), daysLate: 12,
    })
    expect(msg).toContain('Kechikkan: 12 kun')
  })

  it('imported nasiya Telegram message omits placeholder IMEI and keeps USD plus UZS context', () => {
    const msg = nasiyaImportedMessage({
      shopName: 'Malika',
      customerName: 'Ali',
      customerPhone: '+998900000000',
      device: { ...fullDevice, imei: 'IMPORT-abc' },
      originalTotalAmount: 2_500_000,
      alreadyPaidBeforeImport: 1_250_000,
      remainingDebt: 1_250_000,
      monthlyPayment: 625_000,
      nextPaymentDate: new Date(2026, 7, 1),
      currency: { currency: 'USD', usdUzsRate: 12_500 },
    })

    expect(msg).not.toContain('IMPORT-')
    expect(msg).not.toContain('IMEI')
    expect(msg).toContain('Eski nasiya summasi: $200.00')
    expect(msg).toMatch(/~2.?500.?000 so‘m/)
    expect(msg).toContain("Oylik to‘lov: $50.00")
  })
})

describe('sale debt messages', () => {
  it('sale payment shows remaining debt and cleared label', () => {
    const open = salePaymentMessage({
      shopName: 'M', customerName: 'A', customerPhone: '+998900000000', device: fullDevice,
      paidAmount: 1_000_000, contractCurrency: 'UZS', paymentMethod: 'CASH', remaining: 500_000, note: null, adminName: 'D',
    })
    expect(open).toMatch(/Qolgan qarz: 500.?000 so‘m/)
    expect(open).not.toContain('Izoh') // note null -> omitted
    const cleared = salePaymentMessage({
      shopName: 'M', customerName: 'A', device: fullDevice,
      paidAmount: 500_000, contractCurrency: 'UZS', paymentMethod: 'CASH', remaining: 0,
    })
    expect(cleared).toContain("Qolgan qarz: To‘liq yopildi")
  })

  it('sale due + overdue include due date and daysLate', () => {
    const due = saleDueTodayMessage({
      customerName: 'A', customerPhone: '+998900000000', device: fullDevice,
      remainingAmount: 2_000_000, dueDate: new Date(2026, 7, 1),
    })
    expect(due).toContain('Muddat: Bugun')
    const overdue = saleOverdueMessage({
      customerName: 'A', customerPhone: '+998900000000', device: fullDevice,
      remainingAmount: 2_000_000, dueDate: new Date(2026, 6, 1), daysLate: 9,
    })
    expect(overdue).toContain('Kechikkan: 9 kun')
  })
})

describe('global safety across every template', () => {
  const messages = [
    startSuperAdminMessage('A'),
    startShopAdminMessage('A', 'Shop'),
    startUnknownMessage('123456789'),
    unknownCommandMessage(),
    deviceAddedMessage({ shopName: 'S', device: fullDevice, purchasePrice: 1, purchaseCurrency: 'UZS', supplierPhone: '1', adminName: 'A' }),
    deviceSoldMessage({ shopName: 'S', device: fullDevice, customerName: 'A', customerPhone: '1', salePrice: 1, paidAmount: 1, remaining: 0, contractCurrency: 'UZS', paymentMethod: 'CASH', adminName: 'A' }),
    deviceReturnedMessage({ shopName: 'S', device: fullDevice, refundAmount: 1, refundMethod: 'CASH', note: 'n', adminName: 'A' }),
    deviceRestockedMessage({ shopName: 'S', device: fullDevice, note: 'n', adminName: 'A' }),
    nasiyaCreatedMessage({ shopName: 'S', customerName: 'A', customerPhone: '1', device: fullDevice, totalAmount: 1, downPayment: 1, baseRemainingAmount: 1, interestPercent: 20, interestAmount: 1, finalNasiyaAmount: 1, months: 6, monthlyPayment: 1, nextPaymentDate: new Date(), adminName: 'A' }),
    nasiyaImportedMessage({ shopName: 'S', customerName: 'A', customerPhone: '1', device: fullDevice, originalTotalAmount: 1, alreadyPaidBeforeImport: 0, remainingDebt: 1, monthlyPayment: 1, nextPaymentDate: new Date(), adminName: 'A' }),
    nasiyaPaymentMessage({ shopName: 'S', customerName: 'A', customerPhone: '1', device: fullDevice, month: 1, paidAmount: 1, contractCurrency: 'UZS', paymentMethod: 'CASH', remaining: 1, note: 'n', adminName: 'A' }),
    nasiyaDueTodayMessage({ customerName: 'A', customerPhone: '1', device: fullDevice, month: 1, amountDue: 1, contractCurrency: 'UZS', dueDate: new Date() }),
    nasiyaOverdueMessage({ customerName: 'A', customerPhone: '1', device: fullDevice, month: 1, amountDue: 1, contractCurrency: 'UZS', dueDate: new Date(), daysLate: 1 }),
    salePaymentMessage({ shopName: 'S', customerName: 'A', customerPhone: '1', device: fullDevice, paidAmount: 1, contractCurrency: 'UZS', paymentMethod: 'CASH', remaining: 1, note: 'n', adminName: 'A' }),
    saleDueTodayMessage({ customerName: 'A', customerPhone: '1', device: fullDevice, remainingAmount: 1, dueDate: new Date() }),
    saleOverdueMessage({ customerName: 'A', customerPhone: '1', device: fullDevice, remainingAmount: 1, dueDate: new Date(), daysLate: 1 }),
  ]

  it('never mentions /link or a link KOD instruction', () => {
    for (const msg of messages) {
      expect(msg.toLowerCase()).not.toContain('/link')
      expect(msg).not.toContain('KOD')
    }
  })

  it('contains no Markdown-style literal asterisks', () => {
    for (const msg of messages) {
      expect(msg).not.toContain('*')
    }
  })

  it('leaks no sensitive field names / URLs', () => {
    const forbidden = ['passportPhotoUrl', 'password', 'passwordHash', 'token', 'DATABASE_URL', 'signedUrl', 'attachmentUrl', 'http://', 'https://']
    for (const msg of messages) {
      for (const word of forbidden) {
        expect(msg).not.toContain(word)
      }
    }
  })
})
