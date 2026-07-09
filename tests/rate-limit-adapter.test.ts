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

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
    if (originalUrl === undefined) delete process.env.UPSTASH_REDIS_REST_URL
    else process.env.UPSTASH_REDIS_REST_URL = originalUrl
    if (originalToken === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN
    else process.env.UPSTASH_REDIS_REST_TOKEN = originalToken
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

  it('uses Upstash when both env vars are present, parsing the pipeline response', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io'
    process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token'
    vi.resetModules()
    const { checkRateLimitDistributed, resetRateLimitAdapterForTests } = await import('@/lib/rate-limit-adapter')
    resetRateLimitAdapterForTests()

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ result: 3 }, { result: 45 }],
    })
    vi.stubGlobal('fetch', fetchSpy)

    const result = await checkRateLimitDistributed('adapter-test-upstash', { windowMs: 60_000, max: 5 })

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://example.upstash.io/pipeline',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(2) // max 5 - count 3
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
        json: async () => [{ result: 6 }, { result: 30 }],
      }),
    )

    const result = await checkRateLimitDistributed('adapter-test-blocked', { windowMs: 60_000, max: 5 })

    expect(result.allowed).toBe(false)
    expect(result.remaining).toBe(0)
    expect(result.retryAfterSeconds).toBe(30)
  })

  it('arms a TTL when Upstash reports none yet (first hit in a window)', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io'
    process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token'
    vi.resetModules()
    const { checkRateLimitDistributed, resetRateLimitAdapterForTests } = await import('@/lib/rate-limit-adapter')
    resetRateLimitAdapterForTests()

    const fetchSpy = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/pipeline')) {
        return Promise.resolve({ ok: true, json: async () => [{ result: 1 }, { result: -1 }] })
      }
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })
    vi.stubGlobal('fetch', fetchSpy)

    const result = await checkRateLimitDistributed('adapter-test-first-hit', { windowMs: 60_000, max: 5 })

    expect(result.allowed).toBe(true)
    expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining('/expire/'), expect.any(Object))
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
})
