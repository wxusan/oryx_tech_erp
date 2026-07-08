import { describe, expect, it } from 'vitest'
import { displayImei, isImportPlaceholderImei, isNoImeiPlaceholder, isPlaceholderImei, telegramImei } from '@/lib/device-display'
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
