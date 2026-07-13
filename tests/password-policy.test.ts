import { describe, expect, it } from 'vitest'
import {
  BCRYPT_MAX_PASSWORD_BYTES,
  isBcryptPasswordWithinLimit,
  passwordByteLength,
} from '@/lib/password-policy'
import { currentPasswordSchema, passwordSchema } from '@/lib/validations'

describe('bcrypt password byte boundary', () => {
  it('accepts 72 bytes and rejects 73 bytes', () => {
    expect(BCRYPT_MAX_PASSWORD_BYTES).toBe(72)
    expect(isBcryptPasswordWithinLimit('a'.repeat(72))).toBe(true)
    expect(isBcryptPasswordWithinLimit('a'.repeat(73))).toBe(false)
  })

  it('counts UTF-8 bytes rather than JavaScript characters', () => {
    expect(passwordByteLength('é'.repeat(36))).toBe(72)
    expect(passwordByteLength('é'.repeat(37))).toBe(74)
    expect(passwordSchema.safeParse('é'.repeat(36)).success).toBe(true)
    expect(passwordSchema.safeParse('é'.repeat(37)).success).toBe(false)
  })

  it('applies the boundary to current-password verification too', () => {
    expect(currentPasswordSchema.safeParse('a'.repeat(72)).success).toBe(true)
    expect(currentPasswordSchema.safeParse('a'.repeat(73)).success).toBe(false)
  })
})
