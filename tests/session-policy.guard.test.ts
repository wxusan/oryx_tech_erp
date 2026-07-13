import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('role-specific session policy', () => {
  it('uses the durable remembered/idle policy to configure the shop timer', () => {
    const shop = read('src/app/(shop)/shop-layout-client.tsx')
    const login = read('src/components/auth/role-login-form.tsx')
    const auth = read('src/lib/auth.ts')
    expect(shop).toContain("sessionPolicy === 'IDLE_10_MINUTES' ? 10 * 60 * 1000 : null")
    expect(login).toContain('Meni eslab qol')
    expect(login).toContain("rememberMe: form.rememberMe ? 'true' : 'false'")
    expect(auth).toContain("input.rememberMe ? REMEMBERED_SESSION_POLICY : IDLE_SESSION_POLICY")
  })

  it('sets super-admin inactivity to ten minutes and shares activity across tabs', () => {
    const admin = read('src/app/(admin)/admin-layout-client.tsx')
    const controls = read('src/components/auth/session-controls.tsx')
    const apiAuth = read('src/lib/api-auth.ts')
    expect(admin).toContain('idleTimeoutMs={10 * 60 * 1000}')
    expect(controls).toContain("const USER_ACTIVITY_KEY = 'oryx:last-user-activity'")
    expect(controls).toContain("window.addEventListener('storage', handleStorage)")
    expect(controls).toContain("fetch('/api/auth/activity'")
    expect(apiAuth).toContain('const ADMIN_IDLE_TIMEOUT_MS = 10 * 60 * 1000')
    expect(apiAuth).toContain('liveSession.lastUserActivityAt.getTime() <= now.getTime() - ADMIN_IDLE_TIMEOUT_MS')
    expect(apiAuth).not.toContain('SHOP_ACTIVITY_WRITE_INTERVAL_MS')
    expect(controls).not.toContain("document.addEventListener('visibilitychange'")
    expect(controls).not.toContain('resetIdleTimer()')
  })
})
