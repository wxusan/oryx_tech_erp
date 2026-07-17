import { describe, expect, it } from 'vitest'
import {
  displayImei,
  isImportPlaceholderImei,
  isNoImeiPlaceholder,
  isPlaceholderImei,
  telegramImei,
  deviceStatusLabel,
  deviceActionLabel,
} from '@/lib/device-display'
import { formatLogValue, targetLabel } from '@/lib/log-format'

describe('device IMEI display helpers', () => {
  it('detects internal import placeholder IMEIs', () => {
    expect(isImportPlaceholderImei('IMPORT-abc')).toBe(true)
    expect(isImportPlaceholderImei('123456789012345')).toBe(false)
  })

  it('uses the empty label for blank or placeholder IMEIs', () => {
    expect(displayImei('IMPORT-abc')).toBe('Kiritilmagan')
    expect(displayImei(null)).toBe('Kiritilmagan')
    expect(displayImei('')).toBe('Kiritilmagan')
  })

  it('omits blank or placeholder IMEIs from Telegram values', () => {
    expect(telegramImei('IMPORT-abc')).toBeNull()
    expect(telegramImei(null)).toBeNull()
    expect(telegramImei('')).toBeNull()
  })

  it('keeps real IMEIs unchanged', () => {
    expect(displayImei('123456789012345')).toBe('123456789012345')
    expect(telegramImei('123456789012345')).toBe('123456789012345')
  })

  it('does not expose placeholders through generic log formatting', () => {
    expect(formatLogValue({ model: 'iPhone', imei: 'IMPORT-abc' })).toBe('iPhone - Kiritilmagan')
    expect(targetLabel('Device', 'abcdef123456', { imei: 'IMPORT-abc' })).toBe('Qurilma: Kiritilmagan')
  })

  it('also hides olib-sotdim NOIMEI- placeholders (missing IMEI at bazaar handoff)', () => {
    expect(isNoImeiPlaceholder('NOIMEI-AB12CD34')).toBe(true)
    expect(isNoImeiPlaceholder('123456789012345')).toBe(false)
    expect(isPlaceholderImei('NOIMEI-AB12CD34')).toBe(true)
    expect(isPlaceholderImei('IMPORT-abc')).toBe(true)
    expect(isPlaceholderImei('123456789012345')).toBe(false)
    expect(displayImei('NOIMEI-AB12CD34')).toBe('Kiritilmagan')
    expect(telegramImei('NOIMEI-AB12CD34')).toBeNull()
  })
})

/**
 * Item 3 — extracted from the device detail page (was an inline object
 * literal + inline function). Pure, no behavior change, unit-tested
 * directly instead of only through the page.
 */
describe('deviceStatusLabel', () => {
  it('maps every known device status to its Uzbek label', () => {
    expect(deviceStatusLabel('IN_STOCK')).toBe('Omborda')
    expect(deviceStatusLabel('SOLD_CASH')).toBe('Naqdga sotilgan')
    expect(deviceStatusLabel('SOLD_DEBT')).toBe('Qarzga sotilgan')
    expect(deviceStatusLabel('SOLD_NASIYA')).toBe('Nasiyaga sotilgan')
    expect(deviceStatusLabel('RETURNED')).toBe('Qaytarilgan')
    expect(deviceStatusLabel('DELETED')).toBe('O‘chirilgan')
  })

  it('uses a readable fallback for an unknown value', () => {
    expect(deviceStatusLabel('SOMETHING_NEW')).toBe('Holat noma’lum')
  })
})

describe('deviceActionLabel', () => {
  it('maps every known device log action to its Uzbek label', () => {
    expect(deviceActionLabel('CREATE')).toBe('Qurilma qo‘shildi')
    expect(deviceActionLabel('SELL')).toBe('Qurilma sotildi')
    expect(deviceActionLabel('CREATE_NASIYA')).toBe('Yangi nasiya yaratildi')
    expect(deviceActionLabel('RETURN')).toBe('Qurilma qaytarildi')
    expect(deviceActionLabel('RESTOCK')).toBe('Qurilma qayta omborga qo‘shildi')
    expect(deviceActionLabel('UPDATE')).toBe('Qurilma ma’lumotlari yangilandi')
    expect(deviceActionLabel('DELETE')).toBe('Qurilma o‘chirildi')
  })

  it('uses a readable fallback for an unknown value', () => {
    expect(deviceActionLabel('SOMETHING_NEW')).toBe('Noma’lum amal')
  })
})
