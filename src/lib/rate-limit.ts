/**
 * Lightweight in-process rate limiter — fixed-window counter per key,
 * mirroring the exact pattern already used for login-failure throttling in
 * `src/lib/auth.ts` (`global.authAttempts`).
 *
 * IMPORTANT LIMITATION: this only rate-limits requests handled by the SAME
 * serverless instance. On Vercel's multi-instance deployment, a client
 * distributed across instances (or simply retried after a cold start spins
 * up a new instance) is not limited by this alone. This is a genuine,
 * documented gap — see docs/audits/security-audit.md — a fully correct,
 * distributed rate limit needs a shared external store (e.g. Upstash
 * Redis), which is not currently provisioned for this project.
 *
 * This is still meaningfully better than nothing for the pre-onboarding
 * demo: it stops a single runaway client/script hitting one warm instance
 * repeatedly (the common case for an accidental retry loop or a bot that
 * hasn't discovered the app is horizontally scaled), it costs nothing to
 * add, and it does not block any legitimate single-admin workflow at the
 * limits chosen below.
 */

interface RateLimitBucket {
  count: number
  windowStart: number
}

declare global {
  var rateLimitBuckets: Map<string, RateLimitBucket> | undefined
}

const buckets = global.rateLimitBuckets ?? new Map<string, RateLimitBucket>()
global.rateLimitBuckets = buckets

// Prevent unbounded growth of the in-memory map across a long-lived
// serverless instance — if this cap is ever hit, oldest windows are dropped
// first (a coarse approximation of LRU, adequate for a single-instance
// abuse-detection heuristic, not a correctness-critical structure).
const MAX_TRACKED_KEYS = 5_000

export interface RateLimitOptions {
  /** Rolling window size in milliseconds. */
  windowMs: number
  /** Maximum allowed requests within one window. */
  max: number
}

export interface RateLimitResult {
  allowed: boolean
  /** Seconds until the caller may retry — only meaningful when `allowed` is false. */
  retryAfterSeconds: number
  remaining: number
}

export function checkRateLimit(key: string, options: RateLimitOptions): RateLimitResult {
  const now = Date.now()
  const existing = buckets.get(key)

  if (!existing || now - existing.windowStart >= options.windowMs) {
    if (buckets.size >= MAX_TRACKED_KEYS) {
      const oldestKey = buckets.keys().next().value
      if (oldestKey !== undefined) buckets.delete(oldestKey)
    }
    buckets.set(key, { count: 1, windowStart: now })
    return { allowed: true, retryAfterSeconds: 0, remaining: options.max - 1 }
  }

  if (existing.count >= options.max) {
    const retryAfterSeconds = Math.max(1, Math.ceil((existing.windowStart + options.windowMs - now) / 1000))
    return { allowed: false, retryAfterSeconds, remaining: 0 }
  }

  existing.count += 1
  return { allowed: true, retryAfterSeconds: 0, remaining: options.max - existing.count }
}

/** Build a rate-limit key scoped to one shop + one route + one actor — never leaks across shops. */
export function rateLimitKey(route: string, shopId: string | null | undefined, actorId: string | null | undefined): string {
  return `${route}:${shopId ?? 'no-shop'}:${actorId ?? 'anon'}`
}
