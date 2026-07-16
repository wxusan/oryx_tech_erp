import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function read(path: string) {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

describe('login performance instrumentation', () => {
  it('measures submit-to-response and response-to-usable-shell without persisting credentials', () => {
    const timing = read('src/lib/login-performance.ts')
    expect(timing).toContain("performance.measure('oryx:login-submit-to-response', mark)")
    expect(timing).toContain("performance.measure('oryx:login-response-to-usable-shell'")
    expect(timing).toContain('sessionStorage.setItem(LOGIN_RESPONSE_STORAGE_KEY')
    expect(timing).not.toContain('password')
  })

  it('records a successful sign-in and consumes the marker from both authenticated shells', () => {
    const form = read('src/components/auth/role-login-form.tsx')
    expect(form).toContain('beginLoginSubmitTiming(mode)')
    expect(form).toContain('completeLoginSubmitTiming(mode, loginTimingMark, !result?.error)')
    expect(read('src/app/(shop)/shop-layout-client.tsx')).toContain("measureAuthenticatedShellUsable('shop')")
    expect(read('src/app/(admin)/admin-layout-client.tsx')).toContain("measureAuthenticatedShellUsable('admin')")
  })
})
