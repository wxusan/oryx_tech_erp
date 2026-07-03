import { describe, it, expect } from 'vitest'
import {
  formatNasiyaNotification,
  paymentMethodLabel,
  formatDeviceReturnNotification,
  formatDeviceRestockNotification,
} from '@/lib/telegram'
import {
  normalizeTelegramId,
  buildStartWelcome,
  START_NOT_LINKED_MESSAGE,
  type TelegramOwner,
} from '@/lib/telegram-id'

describe('normalizeTelegramId', () => {
  it('trims surrounding whitespace', () => {
    expect(normalizeTelegramId('  123456789  ')).toBe('123456789')
  })

  it('returns null for empty / whitespace-only / nullish input', () => {
    expect(normalizeTelegramId('')).toBeNull()
    expect(normalizeTelegramId('   ')).toBeNull()
    expect(normalizeTelegramId(null)).toBeNull()
    expect(normalizeTelegramId(undefined)).toBeNull()
  })

  it('leaves a valid numeric id unchanged (compared as a string)', () => {
    const id = '987654321'
    expect(normalizeTelegramId(id)).toBe(id)
  })
})

describe('buildStartWelcome', () => {
  it('welcomes a super admin generically by name', () => {
    const owner: TelegramOwner = {
      type: 'SUPER_ADMIN',
      user: { id: 'sa1', name: 'Abdulloh', login: 'abdulloh' },
    }
    const msg = buildStartWelcome(owner)
    expect(msg).toContain('Abdulloh')
    expect(msg).toContain('super admin')
    expect(msg).not.toContain("do'koni")
  })

  it('welcomes a shop admin with their shop name', () => {
    const owner: TelegramOwner = {
      type: 'SHOP_ADMIN',
      user: {
        id: 'ad1',
        name: 'Dilshod',
        login: 'dilshod',
        shop: { id: 's1', name: 'Malika Electronics', status: 'ACTIVE' },
      },
    }
    const msg = buildStartWelcome(owner)
    expect(msg).toContain('Dilshod')
    expect(msg).toContain('Malika Electronics')
    expect(msg).toContain("do'koni")
  })
})

describe('START_NOT_LINKED_MESSAGE', () => {
  it('tells the user how to link (Telegram ID + /link)', () => {
    expect(START_NOT_LINKED_MESSAGE).toContain('Telegram ID')
    expect(START_NOT_LINKED_MESSAGE).toContain('/link')
  })
})

describe('paymentMethodLabel', () => {
  it('maps every known method to an Uzbek label', () => {
    expect(paymentMethodLabel('CASH')).toBe('Naqd')
    expect(paymentMethodLabel('TRANSFER')).toBe("O'tkazma")
    expect(paymentMethodLabel('CARD')).toBe('Karta')
    expect(paymentMethodLabel('OTHER')).toBe('Boshqa')
  })

  it('falls back to a dash for unknown / missing methods', () => {
    expect(paymentMethodLabel(undefined)).toBe('-')
    expect(paymentMethodLabel(null)).toBe('-')
    expect(paymentMethodLabel('SOMETHING_ELSE')).toBe('-')
  })
})

describe('formatNasiyaNotification', () => {
  const base = {
    shopName: 'Malika Mobile',
    deviceModel: 'iPhone 15 Pro',
    customerName: 'Ali Valiyev',
    customerPhone: '+998901112233',
    totalAmount: 5_200_000,
    downPayment: 1_500_000,
    months: 6,
    monthlyPayment: 616_667,
    firstDueDate: new Date('2026-08-01T00:00:00.000Z'),
  }

  it('omits percent lines when nasiya percent is 0', () => {
    const msg = formatNasiyaNotification({
      ...base,
      baseRemainingAmount: 3_700_000,
      interestPercent: 0,
      interestAmount: 0,
      finalNasiyaAmount: 3_700_000,
    })

    expect(msg).toContain('Qolgan summa')
    expect(msg).toContain('Nasiya jami')
    expect(msg).not.toContain('Nasiya foizi:')
    expect(msg).not.toContain('Foiz summasi:')
  })

  it('includes percent and interest amount when nasiya percent is above 0', () => {
    const msg = formatNasiyaNotification({
      ...base,
      baseRemainingAmount: 3_700_000,
      interestPercent: 20,
      interestAmount: 740_000,
      finalNasiyaAmount: 4_440_000,
      monthlyPayment: 740_000,
    })

    expect(msg).toContain('Nasiya foizi: 20%')
    expect(msg).toContain('Foiz summasi:')
    expect(msg).toMatch(/740.?000/)
    expect(msg).toMatch(/4.?440.?000/)
  })
})

describe('formatDeviceReturnNotification', () => {
  it('includes model, IMEI, refund amount + method, reason and actor', () => {
    const msg = formatDeviceReturnNotification({
      deviceModel: 'iPhone 13 Pro',
      imei: '123456789012345',
      refundAmount: 8_500_000,
      refundMethod: 'CASH',
      note: 'mijoz bekor qildi',
      actorName: 'Dilshod',
    })
    expect(msg).toContain('qaytarildi')
    expect(msg).toContain('iPhone 13 Pro')
    expect(msg).toContain('123456789012345')
    // Grouped amount, separator-agnostic (ru-RU locale groups with spaces).
    expect(msg).toMatch(/8.?500.?000/)
    expect(msg).toContain("so'm")
    expect(msg).toContain('Naqd')
    expect(msg).toContain('mijoz bekor qildi')
    expect(msg).toContain('Dilshod')
  })

  it('omits the refund-method line when nothing was refunded', () => {
    const msg = formatDeviceReturnNotification({
      deviceModel: 'Galaxy S23',
      imei: '999',
      refundAmount: 0,
      note: 'shartnoma bekor',
    })
    expect(msg).not.toContain('Usul:')
  })

  it('omits the actor line when no actor is provided', () => {
    const msg = formatDeviceReturnNotification({
      deviceModel: 'Galaxy S23',
      imei: '999',
      refundAmount: 0,
      note: 'shartnoma bekor',
    })
    expect(msg).not.toContain('Admin:')
  })
})

describe('formatDeviceRestockNotification', () => {
  it('includes model, IMEI, reason and actor', () => {
    const msg = formatDeviceRestockNotification({
      deviceModel: 'iPhone 13 Pro',
      imei: '123456789012345',
      note: "qayta ko'rikdan o'tdi",
      actorName: 'Dilshod',
    })
    expect(msg).toContain('sotuvga chiqarildi')
    expect(msg).toContain('iPhone 13 Pro')
    expect(msg).toContain('123456789012345')
    expect(msg).toContain("qayta ko'rikdan o'tdi")
    expect(msg).toContain('Dilshod')
  })

  it('omits the actor line when no actor is provided', () => {
    const msg = formatDeviceRestockNotification({
      deviceModel: 'Galaxy S23',
      imei: '999',
      note: 'omborga qaytdi',
    })
    expect(msg).not.toContain('Admin:')
  })
})
