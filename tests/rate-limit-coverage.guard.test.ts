import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

/**
 * Production-readiness follow-up: the sensitive, abuse-prone mutation
 * endpoints (payment creation, import, image upload, sale/nasiya/olib-sotdim
 * creation) each call the rate limiter before doing real work. Login/auth
 * already has its own dedicated lockout mechanism in src/lib/auth.ts
 * (global.authAttempts) — not duplicated here.
 *
 * Item 5 (deferred-items follow-up) — all 10 routes now go through the
 * distributed adapter (src/lib/rate-limit-adapter.ts) instead of calling
 * the in-process src/lib/rate-limit.ts limiter directly, so turning on
 * Upstash (see docs/rate-limiting.md) protects every one of them with zero
 * further code changes.
 */
describe('sensitive routes are wired to the distributed rate limit adapter', () => {
  const protectedRoutes = [
    'src/app/api/sales/[id]/payment/route.ts',
    'src/app/api/nasiya/[id]/payment/route.ts',
    'src/app/api/nasiya/[id]/settlement/route.ts',
    'src/app/api/olib-sotdim/[id]/pay/route.ts',
    'src/app/api/olib-sotdim/route.ts',
    'src/app/api/nasiya/import/route.ts',
    'src/app/api/import/customers/route.ts',
    'src/app/api/uploads/device/route.ts',
    'src/app/api/uploads/passport/route.ts',
    'src/app/api/devices/[id]/sell/route.ts',
    'src/app/api/devices/[id]/nasiya/route.ts',
  ]

  it.each(protectedRoutes)('%s imports and awaits checkRateLimitDistributed', (file) => {
    const source = read(file)
    expect(source).toContain("from '@/lib/rate-limit-adapter'")
    expect(source).toContain('await checkRateLimitDistributed(')
    expect(source).toContain('tooManyRequests(')
  })

  it.each(protectedRoutes)('%s still builds its key via the unchanged rateLimitKey helper', (file) => {
    const source = read(file)
    expect(source).toContain("from '@/lib/rate-limit'")
    expect(source).toContain('rateLimitKey(')
  })
})
