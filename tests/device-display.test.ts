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
    expect(deviceStatusLabel('SOLD_CASH')).toBe('Naqd sotildi')
    expect(deviceStatusLabel('SOLD_DEBT')).toBe('Qarzga sotilgan')
    expect(deviceStatusLabel('SOLD_NASIYA')).toBe('Nasiyada')
    expect(deviceStatusLabel('RETURNED')).toBe('Qaytarilgan (eski holat)')
    expect(deviceStatusLabel('DELETED')).toBe("O'chirilgan")
  })

  it('falls back to the raw status for an unknown value, never blank', () => {
    expect(deviceStatusLabel('SOMETHING_NEW')).toBe('SOMETHING_NEW')
  })
})

describe('deviceActionLabel', () => {
  it('maps every known device log action to its Uzbek label', () => {
    expect(deviceActionLabel('CREATE')).toBe("Qurilma qo'shildi")
    expect(deviceActionLabel('SELL')).toBe('Naqd sotildi')
    expect(deviceActionLabel('CREATE_NASIYA')).toBe('Nasiyaga berildi')
    expect(deviceActionLabel('RETURN')).toBe('Qaytarildi')
    expect(deviceActionLabel('RESTOCK')).toBe('Omborga qaytarildi')
    expect(deviceActionLabel('UPDATE')).toBe("Ma'lumot o'zgartirildi")
    expect(deviceActionLabel('DELETE')).toBe("O'chirildi")
  })

  it('falls back to the raw action for an unknown value', () => {
    expect(deviceActionLabel('SOMETHING_NEW')).toBe('SOMETHING_NEW')
  })
})
