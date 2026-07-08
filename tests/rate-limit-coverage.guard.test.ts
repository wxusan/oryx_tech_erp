import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

/**
 * Production-readiness follow-up: the sensitive, abuse-prone mutation
 * endpoints (payment creation, import, image upload, sale/nasiya/olib-sotdim
 * creation) each call the in-process rate limiter (src/lib/rate-limit.ts)
 * before doing real work. Login/auth already has its own dedicated
 * lockout mechanism in src/lib/auth.ts (global.authAttempts) — not
 * duplicated here.
 */
describe('sensitive routes are wired to the in-process rate limiter', () => {
  const protectedRoutes = [
    'src/app/api/sales/[id]/payment/route.ts',
    'src/app/api/nasiya/[id]/payment/route.ts',
    'src/app/api/olib-sotdim/[id]/pay/route.ts',
    'src/app/api/olib-sotdim/route.ts',
    'src/app/api/nasiya/import/route.ts',
    'src/app/api/import/customers/route.ts',
    'src/app/api/uploads/device/route.ts',
    'src/app/api/uploads/passport/route.ts',
    'src/app/api/devices/[id]/sell/route.ts',
    'src/app/api/devices/[id]/nasiya/route.ts',
  ]

  it.each(protectedRoutes)('%s imports and calls checkRateLimit', (file) => {
    const source = read(file)
    expect(source).toContain("from '@/lib/rate-limit'")
    expect(source).toContain('checkRateLimit(')
    expect(source).toContain('tooManyRequests(')
  })
})
