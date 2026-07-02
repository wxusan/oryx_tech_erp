import { describe, it, expect } from 'vitest'
import {
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
      user: { id: 'sa1', name: 'Abdulloh', email: 'a@oryx.local' },
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
