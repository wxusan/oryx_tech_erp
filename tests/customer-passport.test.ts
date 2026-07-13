import { describe, expect, it } from 'vitest'
import {
  CustomerPassportConfigurationError,
  decryptPassportIdentifier,
  encryptPassportIdentifier,
  hashPassportIdentifier,
  isValidPassportIdentifier,
  maskPassportIdentifier,
  normalizePassportIdentifier,
  passportIdentifierStorage,
} from '@/lib/customer-passport'

const ENCRYPTION_SECRET = 'encryption-test-secret-that-is-long-enough-2026'
const SEARCH_SECRET = 'search-test-secret-that-is-long-enough-2026'

describe('customer passport privacy contract', () => {
  it('normalizes and masks without exposing the full identifier', () => {
    expect(normalizePassportIdentifier(' aa 12-34 567 ')).toBe('AA1234567')
    expect(isValidPassportIdentifier('AA 1234567')).toBe(true)
    expect(maskPassportIdentifier('AA 1234567')).toBe('•••••4567')
  })

  it('creates deterministic secret-scoped search tokens', () => {
    const first = hashPassportIdentifier('AA 1234567', SEARCH_SECRET)
    expect(hashPassportIdentifier('aa-1234567', SEARCH_SECRET)).toBe(first)
    expect(hashPassportIdentifier('AA 1234567', `${SEARCH_SECRET}-different`)).not.toBe(first)
    expect(first).not.toContain('AA1234567')
  })

  it('encrypts with randomized authenticated envelopes and rejects tampering', () => {
    const first = encryptPassportIdentifier('AA 1234567', ENCRYPTION_SECRET)
    const second = encryptPassportIdentifier('AA 1234567', ENCRYPTION_SECRET)
    expect(first).not.toBe(second)
    expect(first).not.toContain('AA1234567')
    expect(decryptPassportIdentifier(first, ENCRYPTION_SECRET)).toBe('AA1234567')

    const tampered = `${first.slice(0, -1)}${first.endsWith('A') ? 'B' : 'A'}`
    expect(() => decryptPassportIdentifier(tampered, ENCRYPTION_SECRET)).toThrow()
  })

  it('returns only storage-safe encrypted/search/display material', () => {
    expect(passportIdentifierStorage('AA 1234567', {
      encryption: ENCRYPTION_SECRET,
      search: SEARCH_SECRET,
    })).toMatchObject({
      passportIdentifierLast4: '4567',
      passportIdentifierKeyVersion: 1,
    })
  })

  it('fails closed when a required secret is weak or absent', () => {
    expect(() => encryptPassportIdentifier('AA1234567', 'short')).toThrow(CustomerPassportConfigurationError)
    expect(() => hashPassportIdentifier('AA1234567', 'short')).toThrow(CustomerPassportConfigurationError)
  })
})
