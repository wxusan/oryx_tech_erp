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
  checkFailures(key: string, options: LoginFailureOptions): Promise<RateLimitResult>
  recordFailure(key: string, options: LoginFailureOptions): Promise<RateLimitResult>
  clearFailures(key: string): Promise<void>
}

export interface LoginFailureOptions extends RateLimitOptions {
  /** How long a threshold-reaching credential key remains locked. */
  lockMs: number
}

interface LoginFailureBucket {
  count: number
  firstFailedAt: number
  lockedUntil: number | null
}

const localLoginFailures = new Map<string, LoginFailureBucket>()
const MAX_LOCAL_LOGIN_KEYS = 5_000

function pruneLocalLoginFailures(now: number) {
  for (const [key, value] of localLoginFailures) {
    if ((value.lockedUntil ?? value.firstFailedAt) < now - 24 * 60 * 60 * 1000) {
      localLoginFailures.delete(key)
    }
  }
  while (localLoginFailures.size >= MAX_LOCAL_LOGIN_KEYS) {
    const oldest = localLoginFailures.keys().next().value
    if (oldest === undefined) break
    localLoginFailures.delete(oldest)
  }
}

function checkLocalFailures(key: string, options: LoginFailureOptions): RateLimitResult {
  const now = Date.now()
  const current = localLoginFailures.get(key)
  if (!current) return { allowed: true, retryAfterSeconds: 0, remaining: options.max }
  if (current.lockedUntil && current.lockedUntil > now) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((current.lockedUntil - now) / 1000)),
      remaining: 0,
    }
  }
  if (now - current.firstFailedAt >= options.windowMs) {
    localLoginFailures.delete(key)
    return { allowed: true, retryAfterSeconds: 0, remaining: options.max }
  }
  return { allowed: true, retryAfterSeconds: 0, remaining: Math.max(0, options.max - current.count) }
}

function recordLocalFailure(key: string, options: LoginFailureOptions): RateLimitResult {
  const now = Date.now()
  pruneLocalLoginFailures(now)
  const existing = localLoginFailures.get(key)
  const current = existing && now - existing.firstFailedAt < options.windowMs
    ? { ...existing, count: existing.count + 1 }
    : { count: 1, firstFailedAt: now, lockedUntil: null }
  if (current.count >= options.max) current.lockedUntil = now + options.lockMs
  localLoginFailures.set(key, current)
  return checkLocalFailures(key, options)
}

class InProcessAdapter implements RateLimitAdapter {
  async checkLimit(key: string, options: RateLimitOptions): Promise<RateLimitResult> {
    return checkInProcessRateLimit(key, options)
  }

  async checkFailures(key: string, options: LoginFailureOptions): Promise<RateLimitResult> {
    return checkLocalFailures(key, options)
  }

  async recordFailure(key: string, options: LoginFailureOptions): Promise<RateLimitResult> {
    return recordLocalFailure(key, options)
  }

  async clearFailures(key: string): Promise<void> {
    localLoginFailures.delete(key)
  }
}

interface UpstashPipelineItem {
  result: number | string | null
}

interface UpstashCommandResponse {
  result: unknown
}

const FIXED_WINDOW_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {count, ttl}
`.trim()

const LOGIN_FAILURE_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
local window_ms = tonumber(ARGV[1])
local lock_ms = tonumber(ARGV[2])
local maximum = tonumber(ARGV[3])
local desired_ttl = window_ms
if count >= maximum then
  desired_ttl = lock_ms
end
if ttl < 0 or (count >= maximum and ttl < lock_ms) then
  redis.call('PEXPIRE', KEYS[1], desired_ttl)
  ttl = desired_ttl
end
return {count, ttl}
`.trim()

class UpstashRateLimitAdapter implements RateLimitAdapter {
  constructor(
    private readonly restUrl: string,
    private readonly restToken: string,
  ) {}

  async checkLimit(key: string, options: RateLimitOptions): Promise<RateLimitResult> {
    try {
      const redisKey = `oryx:ratelimit:${key}`

      // INCR + first-window expiry is one Redis-side operation. A worker
      // crash or second request can never leave a permanent counter behind.
      const [count, ttlMs] = await this.evalNumbers(
        FIXED_WINDOW_SCRIPT,
        redisKey,
        [String(Math.max(1, options.windowMs))],
        'rate limit',
      )
      const retryAfterSeconds = Math.max(1, Math.ceil(ttlMs / 1000))

      if (count > options.max) {
        return { allowed: false, retryAfterSeconds, remaining: 0 }
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

  private async pipeline(commands: string[][]): Promise<UpstashPipelineItem[]> {
    const response = await fetch(`${this.restUrl}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.restToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(commands),
      signal: AbortSignal.timeout(1_500),
    })
    if (!response.ok) throw new Error(`Upstash login throttle request failed: ${response.status}`)
    return response.json() as Promise<UpstashPipelineItem[]>
  }

  private async evalNumbers(
    script: string,
    key: string,
    args: string[],
    operation: string,
  ): Promise<[number, number]> {
    const response = await fetch(this.restUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.restToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(['EVAL', script, '1', key, ...args]),
      signal: AbortSignal.timeout(1_500),
    })
    if (!response.ok) throw new Error(`Upstash ${operation} request failed: ${response.status}`)
    const payload = (await response.json()) as UpstashCommandResponse
    if (!Array.isArray(payload.result) || payload.result.length !== 2) {
      throw new Error(`Upstash ${operation} returned an invalid result`)
    }
    const first = Number(payload.result[0])
    const second = Number(payload.result[1])
    if (!Number.isFinite(first) || !Number.isFinite(second)) {
      throw new Error(`Upstash ${operation} returned non-numeric values`)
    }
    return [first, second]
  }

  async checkFailures(key: string, options: LoginFailureOptions): Promise<RateLimitResult> {
    try {
      const redisKey = `oryx:auth-failures:${key}`
      const [countResult, ttlResult] = await this.pipeline([
        ['GET', redisKey],
        ['TTL', redisKey],
      ])
      const count = Number(countResult.result ?? 0)
      const ttl = Number(ttlResult.result ?? -1)
      if (count >= options.max && ttl > 0) {
        return { allowed: false, retryAfterSeconds: ttl, remaining: 0 }
      }
      return { allowed: true, retryAfterSeconds: 0, remaining: Math.max(0, options.max - count) }
    } catch (err) {
      logger.warn('Upstash login throttle check failed, falling back to in-process limiter', {
        event: 'auth.rate_limit_upstash_failed',
        error: err,
      })
      return checkLocalFailures(key, options)
    }
  }

  async recordFailure(key: string, options: LoginFailureOptions): Promise<RateLimitResult> {
    try {
      const redisKey = `oryx:auth-failures:${key}`
      const [count, ttlMs] = await this.evalNumbers(
        LOGIN_FAILURE_SCRIPT,
        redisKey,
        [String(Math.max(1, options.windowMs)), String(Math.max(1, options.lockMs)), String(options.max)],
        'login throttle',
      )
      if (count >= options.max) {
        return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(ttlMs / 1000)), remaining: 0 }
      }
      return { allowed: true, retryAfterSeconds: 0, remaining: Math.max(0, options.max - count) }
    } catch (err) {
      logger.warn('Upstash login throttle write failed, falling back to in-process limiter', {
        event: 'auth.rate_limit_upstash_failed',
        error: err,
      })
      return recordLocalFailure(key, options)
    }
  }

  async clearFailures(key: string): Promise<void> {
    try {
      const redisKey = `oryx:auth-failures:${key}`
      await this.pipeline([['DEL', redisKey]])
      localLoginFailures.delete(key)
    } catch (err) {
      logger.warn('Upstash login throttle clear failed', {
        event: 'auth.rate_limit_upstash_failed',
        error: err,
      })
      localLoginFailures.delete(key)
    }
  }
}

let cachedAdapter: RateLimitAdapter | null = null

/** Re-reads env on first call only — safe because these env vars never change at runtime. */
export function getRateLimitAdapter(): RateLimitAdapter {
  if (cachedAdapter) return cachedAdapter
  const explicitUpstash = {
    restUrl: process.env.UPSTASH_REDIS_REST_URL,
    restToken: process.env.UPSTASH_REDIS_REST_TOKEN,
  }
  const marketplaceUpstash = {
    restUrl: process.env.KV_REST_API_URL,
    restToken: process.env.KV_REST_API_TOKEN,
  }
  let configuredPair: { restUrl: string; restToken: string } | null = null
  if (explicitUpstash.restUrl && explicitUpstash.restToken) {
    configuredPair = { restUrl: explicitUpstash.restUrl, restToken: explicitUpstash.restToken }
  } else if (marketplaceUpstash.restUrl && marketplaceUpstash.restToken) {
    configuredPair = { restUrl: marketplaceUpstash.restUrl, restToken: marketplaceUpstash.restToken }
  }
  cachedAdapter = configuredPair
    ? new UpstashRateLimitAdapter(configuredPair.restUrl, configuredPair.restToken)
    : new InProcessAdapter()
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

export async function checkLoginFailuresDistributed(key: string, options: LoginFailureOptions): Promise<RateLimitResult> {
  return getRateLimitAdapter().checkFailures(key, options)
}

export async function recordLoginFailureDistributed(key: string, options: LoginFailureOptions): Promise<RateLimitResult> {
  return getRateLimitAdapter().recordFailure(key, options)
}

export async function clearLoginFailuresDistributed(key: string): Promise<void> {
  return getRateLimitAdapter().clearFailures(key)
}
