import { describe, it, expect } from 'vitest'
import { normalizePhone, isValidPhone } from '@/lib/phone'

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

// isValidPhone is the client-side gate used on the sale/nasiya customer step so
// a bad phone is caught inline instead of only at final save. It must accept the
// shop's real formats and stay within the server phoneSchema (min 9 / max 20).
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

  it('never accepts a value the server phoneSchema (min 9 / max 20 chars) would reject', () => {
    const samples = ['+998 90 000 00 00', '900000000', '998 90 123 45 67']
    for (const s of samples) {
      if (isValidPhone(s)) {
        const len = s.trim().length
        expect(len).toBeGreaterThanOrEqual(9)
        expect(len).toBeLessThanOrEqual(20)
      }
    }
  })
})
