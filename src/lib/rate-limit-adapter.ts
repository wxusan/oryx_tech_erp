import { checkRateLimit as checkInProcessRateLimit, type RateLimitOptions, type RateLimitResult } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'

/**
 * Item 5 — distributed rate limiting adapter. `src/lib/rate-limit.ts`'s
 * `checkRateLimit` only limits requests handled by the SAME serverless
 * instance (documented gap — see its doc comment and
 * docs/audits/security-audit.md). This adapter picks a real distributed
 * limiter (Upstash Redis, over its REST API — no extra npm dependency
 * needed) when it's configured, and falls back to the exact same
 * in-process behavior otherwise, so every existing deployment keeps working
 * unchanged. See docs/rate-limiting.md for env vars + deployment steps.
 */
export interface RateLimitAdapter {
  checkLimit(key: string, options: RateLimitOptions): Promise<RateLimitResult>
}

class InProcessAdapter implements RateLimitAdapter {
  async checkLimit(key: string, options: RateLimitOptions): Promise<RateLimitResult> {
    return checkInProcessRateLimit(key, options)
  }
}

interface UpstashPipelineItem {
  result: number
}

class UpstashRateLimitAdapter implements RateLimitAdapter {
  constructor(
    private readonly restUrl: string,
    private readonly restToken: string,
  ) {}

  async checkLimit(key: string, options: RateLimitOptions): Promise<RateLimitResult> {
    try {
      const windowSeconds = Math.max(1, Math.ceil(options.windowMs / 1000))
      const redisKey = `oryx:ratelimit:${key}`

      // One round trip: INCR the counter, read its current TTL.
      const res = await fetch(`${this.restUrl}/pipeline`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.restToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify([
          ['INCR', redisKey],
          ['TTL', redisKey],
        ]),
      })
      if (!res.ok) throw new Error(`Upstash rate limit request failed: ${res.status}`)

      const [incrResult, ttlResult] = (await res.json()) as [UpstashPipelineItem, UpstashPipelineItem]
      const count = incrResult.result
      let ttl = ttlResult.result

      // No TTL yet (either the very first hit in this window, or the key
      // was created without one) — arm it now so the counter actually resets.
      if (ttl < 0) {
        await fetch(`${this.restUrl}/expire/${encodeURIComponent(redisKey)}/${windowSeconds}`, {
          headers: { Authorization: `Bearer ${this.restToken}` },
        }).catch(() => {})
        ttl = windowSeconds
      }

      if (count > options.max) {
        return { allowed: false, retryAfterSeconds: Math.max(1, ttl), remaining: 0 }
      }
      return { allowed: true, retryAfterSeconds: 0, remaining: Math.max(0, options.max - count) }
    } catch (err) {
      // A rate-limit backend outage must never take down real traffic —
      // fail open to the in-process limiter (same as before Upstash existed).
      logger.warn('Upstash rate limit check failed, falling back to in-process limiter', {
        event: 'rate_limit.upstash_failed',
        error: err,
      })
      return checkInProcessRateLimit(key, options)
    }
  }
}

let cachedAdapter: RateLimitAdapter | null = null

/** Re-reads env on first call only — safe because these env vars never change at runtime. */
export function getRateLimitAdapter(): RateLimitAdapter {
  if (cachedAdapter) return cachedAdapter
  const restUrl = process.env.UPSTASH_REDIS_REST_URL
  const restToken = process.env.UPSTASH_REDIS_REST_TOKEN
  cachedAdapter = restUrl && restToken ? new UpstashRateLimitAdapter(restUrl, restToken) : new InProcessAdapter()
  return cachedAdapter
}

/** Test-only escape hatch to force a fresh adapter pick after mutating env vars. */
export function resetRateLimitAdapterForTests(): void {
  cachedAdapter = null
}

/** Drop-in async replacement for `checkRateLimit` — distributed when Upstash is configured, in-process otherwise. */
export async function checkRateLimitDistributed(key: string, options: RateLimitOptions): Promise<RateLimitResult> {
  return getRateLimitAdapter().checkLimit(key, options)
}
