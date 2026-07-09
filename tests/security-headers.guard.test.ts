import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

/**
 * Production-readiness follow-up: safe security headers applied globally.
 * Item 6 (follow-up ticket) added a Content-Security-Policy in REPORT-ONLY
 * mode — see the comment in next.config.ts for the enumerated origins and
 * the concrete blocking issue (no nonce wired up yet) standing between this
 * and a strictly enforcing policy.
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

  it('ships a Content-Security-Policy in Report-Only mode (never blocking) and documents the concrete blocking issue for enforcing mode', () => {
    expect(config).toContain("key: 'Content-Security-Policy-Report-Only'")
    expect(config).not.toContain("key: 'Content-Security-Policy',")
    expect(config).toContain("doesn't yet wire a nonce through middleware")
  })

  it('the policy covers script/style/img/font/connect/object/frame-ancestors, and allows the Supabase storage origin for signed-URL images', () => {
    expect(config).toContain("script-src 'self' 'unsafe-inline'")
    expect(config).toContain("style-src 'self' 'unsafe-inline'")
    expect(config).toContain("object-src 'none'")
    expect(config).toContain("frame-ancestors 'self'")
    expect(config).toContain('process.env.SUPABASE_URL')
  })
})
