import { describe, it, expect } from 'vitest'
import {
  normalizePhone,
  isValidPhone,
  applyPhonePrefix,
  normalizeAdditionalPhones,
  formatUzPhoneDisplay,
  normalizeUzPhone,
} from '@/lib/phone'

// normalizePhone underpins active-per-shop customer phone uniqueness (req 10).
describe('normalizePhone (req 10)', () => {
  it('strips all non-digit characters', () => {
    expect(normalizePhone('+998 (90) 123-45-67')).toBe('998901234567')
    expect(normalizePhone('90 123 45 67')).toBe('901234567')
  })

  it('treats differently-formatted equal numbers as identical', () => {
    expect(normalizePhone('+998901234567')).toBe(normalizePhone('998 90 123 45 67'))
  })

  it('returns null when there are no digits (so the partial unique index ignores it)', () => {
    expect(normalizePhone('')).toBeNull()
    expect(normalizePhone('   ')).toBeNull()
    expect(normalizePhone('n/a')).toBeNull()
  })
})

// isValidPhone is the client-side and server-side gate used by every Uzbek
// phone field. It accepts common local/full formats but requires exactly nine
// local digits before an API may persist the number.
describe('isValidPhone (client customer-step gate)', () => {
  it('accepts the supported Uzbek formats', () => {
    expect(isValidPhone('+998 90 000 00 00')).toBe(true)
    expect(isValidPhone('+998900000000')).toBe(true)
    expect(isValidPhone('998900000000')).toBe(true)
    expect(isValidPhone('900000000')).toBe(true)
  })

  it('rejects garbage and too-short numbers (blocks advancing to the next step)', () => {
    expect(isValidPhone('')).toBe(false)
    expect(isValidPhone('   ')).toBe(false)
    expect(isValidPhone('123')).toBe(false)
    expect(isValidPhone('abcdefghij')).toBe(false)
    expect(isValidPhone('12345678')).toBe(false) // 8 digits
  })

  it('rejects too-long input instead of silently accepting it', () => {
    expect(isValidPhone('+9989012345678')).toBe(false)
    expect(isValidPhone('9012345678')).toBe(false)
  })
})

// applyPhonePrefix drives the shared PhoneInput component (item 3): typing a
// local number should auto-prefix "998" without the user entering it, and
// pasting an already-prefixed number should never duplicate it.
describe('applyPhonePrefix (auto 998 prefix)', () => {
  it('typing a local number auto-prefixes 998, live as the user types', () => {
    expect(applyPhonePrefix('9')).toBe('+9989')
    expect(applyPhonePrefix('90')).toBe('+99890')
    expect(applyPhonePrefix('901234567')).toBe('+998901234567')
  })

  it('pasting +998... works and is not duplicated', () => {
    expect(applyPhonePrefix('+998901234567')).toBe('+998901234567')
  })

  it('pasting 998... (no plus) works and is not duplicated', () => {
    expect(applyPhonePrefix('998901234567')).toBe('+998901234567')
  })

  it('never produces a duplicated 998998 prefix', () => {
    expect(applyPhonePrefix('998998901234567')).toBe('+998901234567')
    expect(applyPhonePrefix('+998 998 90 123 45 67')).toBe('+998901234567')
  })

  it('normalizes spaces/dashes/parens the same as a plain digit string', () => {
    expect(applyPhonePrefix('90 123 45 67')).toBe('+998901234567')
    expect(applyPhonePrefix('90-123-45-67')).toBe('+998901234567')
    expect(applyPhonePrefix('(90) 123 45 67')).toBe('+998901234567')
  })

  it('returns an empty string for an empty field (does not force a prefix on nothing)', () => {
    expect(applyPhonePrefix('')).toBe('')
  })

  it('preserves excess digits for correction, and the shared validator rejects them', () => {
    expect(applyPhonePrefix('9012345671234')).toBe('+9989012345671234')
    expect(isValidPhone(applyPhonePrefix('9012345671234'))).toBe(false)
  })

  it('every output stays a valid phone by the existing isValidPhone gate', () => {
    for (const raw of ['901234567', '+998901234567', '998901234567', '90 123 45 67']) {
      expect(isValidPhone(applyPhonePrefix(raw))).toBe(true)
    }
  })
})

describe('canonical Uzbek phone display and storage', () => {
  it('formats a canonical, local, or pasted phone consistently for display', () => {
    expect(formatUzPhoneDisplay('+998901234567')).toBe('+998 90 123 45 67')
    expect(formatUzPhoneDisplay('901234567')).toBe('+998 90 123 45 67')
    expect(formatUzPhoneDisplay('+998 90 123 45 67')).toBe('+998 90 123 45 67')
  })

  it('normalizes all supported entry formats to one submitted value', () => {
    expect(normalizeUzPhone('901234567')).toBe('+998901234567')
    expect(normalizeUzPhone('998901234567')).toBe('+998901234567')
    expect(normalizeUzPhone('+998901234567')).toBe('+998901234567')
    expect(normalizeUzPhone('+998 90 123 45 67')).toBe('+998901234567')
  })

  it('accepts the legacy leading 8 only when it prefixes a complete local number', () => {
    expect(normalizeUzPhone('8901234567')).toBe('+998901234567')
    expect(normalizeUzPhone('88')).toBeNull()
  })

  it('keeps optional empty input empty and rejects an incomplete prefix', () => {
    expect(normalizeUzPhone('')).toBeNull()
    expect(applyPhonePrefix('')).toBe('')
    expect(normalizeUzPhone('+998')).toBeNull()
  })
})

// normalizeAdditionalPhones drives item 4 (extra customer phone numbers) —
// storage-side normalization so search can match an extra number the same
// way it matches the primary phone.
describe('normalizeAdditionalPhones (item 4 — additional customer phones)', () => {
  it('normalizes each valid entry to digits-only', () => {
    expect(normalizeAdditionalPhones(['+998 91 234 56 78'])).toEqual(['998912345678'])
  })

  it('drops invalid/garbage entries safely instead of throwing', () => {
    expect(normalizeAdditionalPhones(['abc', '', '   ', '123'])).toEqual([])
  })

  it('de-duplicates equivalent numbers written in different formats', () => {
    expect(normalizeAdditionalPhones(['+998912345678', '998 91 234 56 78'])).toEqual(['998912345678'])
  })

  it('excludes an extra number that is actually the same as the primary phone', () => {
    expect(normalizeAdditionalPhones(['+998901234567'], '998901234567')).toEqual([])
  })

  it('keeps a genuinely different extra number alongside the primary', () => {
    expect(normalizeAdditionalPhones(['+998912345678'], '998901234567')).toEqual(['998912345678'])
  })

  it('returns an empty array for an empty input list', () => {
    expect(normalizeAdditionalPhones([])).toEqual([])
  })
})
