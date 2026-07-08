import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { checkRateLimit, rateLimitKey } from '@/lib/rate-limit'

/**
 * Lightweight in-process rate limiter — see the doc comment in
 * src/lib/rate-limit.ts for the documented per-instance-only limitation
 * (needs Upstash/Redis for a real distributed limit; deferred, no external
 * infra provisioned for this project yet).
 */
describe('checkRateLimit', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-08T00:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('allows a normal, low-frequency caller', () => {
    const key = `test:${Math.random()}`
    const result = checkRateLimit(key, { windowMs: 60_000, max: 5 })
    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(4)
  })

  it('allows requests up to the max within the window', () => {
    const key = `test:${Math.random()}`
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit(key, { windowMs: 60_000, max: 5 }).allowed).toBe(true)
    }
  })

  it('blocks the request once the max is exceeded within the window, returning a positive retryAfterSeconds', () => {
    const key = `test:${Math.random()}`
    for (let i = 0; i < 5; i++) {
      checkRateLimit(key, { windowMs: 60_000, max: 5 })
    }
    const blocked = checkRateLimit(key, { windowMs: 60_000, max: 5 })
    expect(blocked.allowed).toBe(false)
    expect(blocked.remaining).toBe(0)
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0)
    expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(60)
  })

  it('resets the window after it expires, allowing requests again', () => {
    const key = `test:${Math.random()}`
    for (let i = 0; i < 5; i++) {
      checkRateLimit(key, { windowMs: 60_000, max: 5 })
    }
    expect(checkRateLimit(key, { windowMs: 60_000, max: 5 }).allowed).toBe(false)

    vi.advanceTimersByTime(60_001)

    const afterReset = checkRateLimit(key, { windowMs: 60_000, max: 5 })
    expect(afterReset.allowed).toBe(true)
    expect(afterReset.remaining).toBe(4)
  })

  it('tracks different keys independently — one shop/route being limited never affects another', () => {
    const keyA = `test-a:${Math.random()}`
    const keyB = `test-b:${Math.random()}`
    for (let i = 0; i < 5; i++) checkRateLimit(keyA, { windowMs: 60_000, max: 5 })
    expect(checkRateLimit(keyA, { windowMs: 60_000, max: 5 }).allowed).toBe(false)
    expect(checkRateLimit(keyB, { windowMs: 60_000, max: 5 }).allowed).toBe(true)
  })
})

describe('rateLimitKey', () => {
  it('scopes the key to route + shop + actor, so two shops on the same route never collide', () => {
    const keyShopA = rateLimitKey('sale-payment', 'shop-a', 'user-1')
    const keyShopB = rateLimitKey('sale-payment', 'shop-b', 'user-1')
    expect(keyShopA).not.toBe(keyShopB)
  })

  it('falls back to safe placeholders for missing shopId/actorId', () => {
    expect(rateLimitKey('import', null, undefined)).toBe('import:no-shop:anon')
  })
})
