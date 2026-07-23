import { describe, expect, it } from 'vitest'
import { sameMoney } from '@/lib/idempotency-replay'

describe('idempotency money matching', () => {
  it('matches only exact native minor units', () => {
    expect(sameMoney('100.00', 100, 'UZS')).toBe(true)
    expect(sameMoney('10.50', 10.5, 'USD')).toBe(true)
    expect(sameMoney(100, 100.4, 'UZS')).toBe(false)
    expect(sameMoney(10.5, 10.501, 'USD')).toBe(false)
    expect(sameMoney('10.500', '10.50', 'USD')).toBe(true)
    expect(sameMoney(0.29, '0.29', 'USD')).toBe(true)
    expect(sameMoney('10.501', '10.50', 'USD')).toBe(false)
    expect(sameMoney('100.0001', '100', 'UZS')).toBe(false)
    expect(sameMoney(Number.NaN, 0, 'UZS')).toBe(false)
    expect(sameMoney(Number.POSITIVE_INFINITY, 0, 'USD')).toBe(false)
  })
})
