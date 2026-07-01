import { describe, it, expect } from 'vitest'
import { normalizePhone } from '@/lib/phone'

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
