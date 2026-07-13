import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

/**
 * Production-readiness follow-up: safe security headers applied globally.
 * Content-Security-Policy is enforced with the app's explicit origins. See
 * next.config.ts for the remaining nonce limitation that still requires
 * unsafe-inline for Next hydration and UI styles.
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

  it('enforces a baseline Content-Security-Policy and delegates protected-page script nonces to proxy', () => {
    expect(config).toContain("key: 'Content-Security-Policy'")
    expect(config).not.toContain("Content-Security-Policy-Report-Only")
    expect(config).toContain('per-request script nonce from src/proxy.ts')
  })

  it('the policy covers script/style/img/font/connect/object/frame-ancestors, and allows the Supabase storage origin for signed-URL images', () => {
    expect(config).toContain("script-src 'self' 'unsafe-inline'")
    expect(config).toContain("style-src 'self' 'unsafe-inline'")
    expect(config).toContain("object-src 'none'")
    expect(config).toContain("frame-ancestors 'self'")
    expect(config).toContain('process.env.SUPABASE_URL')
  })
})
