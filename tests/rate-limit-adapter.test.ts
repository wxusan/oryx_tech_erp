import { describe, it, expect, vi, afterEach } from 'vitest'

/**
 * Item 5 — distributed rate limiting adapter. Verifies the factory picks
 * Upstash only when both env vars are set, that the Upstash path correctly
 * parses its pipeline response into allowed/blocked, and that any Upstash
 * failure fails OPEN to the in-process limiter rather than blocking real
 * traffic.
 */
describe('getRateLimitAdapter', () => {
  const originalUrl = process.env.UPSTASH_REDIS_REST_URL
  const originalToken = process.env.UPSTASH_REDIS_REST_TOKEN
  const originalMarketplaceUrl = process.env.KV_REST_API_URL
  const originalMarketplaceToken = process.env.KV_REST_API_TOKEN

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
    if (originalUrl === undefined) delete process.env.UPSTASH_REDIS_REST_URL
    else process.env.UPSTASH_REDIS_REST_URL = originalUrl
    if (originalToken === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN
    else process.env.UPSTASH_REDIS_REST_TOKEN = originalToken
    if (originalMarketplaceUrl === undefined) delete process.env.KV_REST_API_URL
    else process.env.KV_REST_API_URL = originalMarketplaceUrl
    if (originalMarketplaceToken === undefined) delete process.env.KV_REST_API_TOKEN
    else process.env.KV_REST_API_TOKEN = originalMarketplaceToken
  })

  it('falls back to the in-process limiter when Upstash env vars are absent', async () => {
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
    vi.resetModules()
    const { checkRateLimitDistributed, resetRateLimitAdapterForTests } = await import('@/lib/rate-limit-adapter')
    resetRateLimitAdapterForTests()
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const result = await checkRateLimitDistributed(`adapter-test:${Math.random()}`, { windowMs: 60_000, max: 5 })

    expect(result.allowed).toBe(true)
    expect(fetchSpy).not.toHaveBeenCalled() // never touches the network without Upstash configured
  })

  it('uses one atomic Upstash script for increment and expiry', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io'
    process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token'
    vi.resetModules()
    const { checkRateLimitDistributed, resetRateLimitAdapterForTests } = await import('@/lib/rate-limit-adapter')
    resetRateLimitAdapterForTests()

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: [3, 45_000] }),
    })
    vi.stubGlobal('fetch', fetchSpy)

    const result = await checkRateLimitDistributed('adapter-test-upstash', { windowMs: 60_000, max: 5 })

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://example.upstash.io',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('EVAL'),
      }),
    )
    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(2) // max 5 - count 3
  })

  it('uses the standard Vercel Marketplace Upstash variable pair', async () => {
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
    process.env.KV_REST_API_URL = 'https://marketplace.upstash.io'
    process.env.KV_REST_API_TOKEN = 'marketplace-token'
    vi.resetModules()
    const { checkRateLimitDistributed, resetRateLimitAdapterForTests } = await import('@/lib/rate-limit-adapter')
    resetRateLimitAdapterForTests()
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: [1, 45_000] }),
    })
    vi.stubGlobal('fetch', fetchSpy)

    const result = await checkRateLimitDistributed('adapter-test-marketplace', {
      windowMs: 60_000,
      max: 5,
    })

    expect(result.allowed).toBe(true)
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://marketplace.upstash.io',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('blocks once the Upstash-reported count exceeds max', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io'
    process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token'
    vi.resetModules()
    const { checkRateLimitDistributed, resetRateLimitAdapterForTests } = await import('@/lib/rate-limit-adapter')
    resetRateLimitAdapterForTests()

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ result: [6, 30_000] }),
      }),
    )

    const result = await checkRateLimitDistributed('adapter-test-blocked', { windowMs: 60_000, max: 5 })

    expect(result.allowed).toBe(false)
    expect(result.remaining).toBe(0)
    expect(result.retryAfterSeconds).toBe(30)
  })

  it('asks the atomic script to arm a millisecond TTL on the first hit', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io'
    process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token'
    vi.resetModules()
    const { checkRateLimitDistributed, resetRateLimitAdapterForTests } = await import('@/lib/rate-limit-adapter')
    resetRateLimitAdapterForTests()

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: [1, 60_000] }),
    })
    vi.stubGlobal('fetch', fetchSpy)

    const result = await checkRateLimitDistributed('adapter-test-first-hit', { windowMs: 60_000, max: 5 })

    expect(result.allowed).toBe(true)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://example.upstash.io',
      expect.objectContaining({ body: expect.stringContaining('60000') }),
    )
  })

  it('fails OPEN to the in-process limiter when the Upstash request throws (never blocks real traffic on a backend outage)', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io'
    process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token'
    vi.resetModules()
    const { checkRateLimitDistributed, resetRateLimitAdapterForTests } = await import('@/lib/rate-limit-adapter')
    resetRateLimitAdapterForTests()

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))

    const result = await checkRateLimitDistributed(`adapter-test-outage:${Math.random()}`, { windowMs: 60_000, max: 5 })

    expect(result.allowed).toBe(true) // in-process fallback allows a fresh key
  })

  it('tracks failed logins without charging successful credential checks and clears an identity after success', async () => {
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
    vi.resetModules()
    const {
      checkLoginFailuresDistributed,
      clearLoginFailuresDistributed,
      recordLoginFailureDistributed,
      resetRateLimitAdapterForTests,
    } = await import('@/lib/rate-limit-adapter')
    resetRateLimitAdapterForTests()
    const key = `login-local:${Math.random()}`
    const options = { windowMs: 60_000, lockMs: 600_000, max: 3 }

    expect(await checkLoginFailuresDistributed(key, options)).toMatchObject({ allowed: true, remaining: 3 })
    await recordLoginFailureDistributed(key, options)
    await recordLoginFailureDistributed(key, options)
    expect(await checkLoginFailuresDistributed(key, options)).toMatchObject({ allowed: true, remaining: 1 })
    await recordLoginFailureDistributed(key, options)
    expect(await checkLoginFailuresDistributed(key, options)).toMatchObject({ allowed: false, remaining: 0 })

    await clearLoginFailuresDistributed(key)
    expect(await checkLoginFailuresDistributed(key, options)).toMatchObject({ allowed: true, remaining: 3 })
  })

  it('uses the distributed failure counter and extends threshold-reaching keys to the lock TTL', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io'
    process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token'
    vi.resetModules()
    const { recordLoginFailureDistributed, resetRateLimitAdapterForTests } = await import('@/lib/rate-limit-adapter')
    resetRateLimitAdapterForTests()
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: [5, 600_000] }),
    })
    vi.stubGlobal('fetch', fetchSpy)

    const result = await recordLoginFailureDistributed('login-upstash', {
      windowMs: 15 * 60_000,
      lockMs: 10 * 60_000,
      max: 5,
    })

    expect(result).toEqual({ allowed: false, retryAfterSeconds: 600, remaining: 0 })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://example.upstash.io',
      expect.objectContaining({
        body: expect.stringMatching(/EVAL.*oryx:auth-failures:login-upstash.*900000.*600000.*5/),
      }),
    )
  })
})
