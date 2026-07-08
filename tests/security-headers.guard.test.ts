import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

/**
 * Production-readiness follow-up: safe security headers applied globally.
 * CSP is deliberately NOT added yet — see the comment in next.config.ts for
 * why (risk of breaking hydration scripts / Supabase-hosted images / inline
 * styles without a dedicated audit pass) and the documented next step.
 */
describe('next.config.ts: security headers applied to every response', () => {
  const config = read('next.config.ts')

  it('disables the X-Powered-By header', () => {
    expect(config).toContain('poweredByHeader: false')
  })

  it('applies headers globally via the async headers() config, not scoped to one route', () => {
    expect(config).toContain("source: '/:path*'")
  })

  it('sets X-Content-Type-Options: nosniff', () => {
    expect(config).toContain("key: 'X-Content-Type-Options', value: 'nosniff'")
  })

  it('sets X-Frame-Options to prevent clickjacking', () => {
    expect(config).toContain("key: 'X-Frame-Options', value: 'SAMEORIGIN'")
  })

  it('sets a conservative Referrer-Policy', () => {
    expect(config).toContain("key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin'")
  })

  it('sets a conservative Permissions-Policy (no camera/mic/geolocation — none are used)', () => {
    expect(config).toContain("key: 'Permissions-Policy'")
    expect(config).toContain('camera=()')
    expect(config).toContain('microphone=()')
    expect(config).toContain('geolocation=()')
  })

  it('sets Strict-Transport-Security (safe: Vercel terminates TLS, no non-HTTPS production path)', () => {
    expect(config).toContain("key: 'Strict-Transport-Security'")
  })

  it('documents why Content-Security-Policy is deferred, rather than silently omitting it', () => {
    expect(config).toContain('Content-Security-Policy is intentionally NOT added yet')
  })
})
