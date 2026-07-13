import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('role-specific session policy', () => {
  it('disables inactivity logout for shop but keeps explicit SessionControls', () => {
    const shop = read('src/app/(shop)/shop-layout-client.tsx')
    expect(shop).toContain('<SessionControls callbackUrl="/shop/login" idleTimeoutMs={null} />')
  })

  it('sets super-admin inactivity to ten minutes and shares activity across tabs', () => {
    const admin = read('src/app/(admin)/admin-layout-client.tsx')
    const controls = read('src/components/auth/session-controls.tsx')
    const apiAuth = read('src/lib/api-auth.ts')
    expect(admin).toContain('idleTimeoutMs={10 * 60 * 1000}')
    expect(controls).toContain("const ADMIN_ACTIVITY_KEY = 'oryx:admin-last-activity'")
    expect(controls).toContain("window.addEventListener('storage', handleStorage)")
    expect(controls).toContain("fetch('/api/auth/activity'")
    expect(apiAuth).toContain('const ADMIN_IDLE_TIMEOUT_MS = 10 * 60 * 1000')
    expect(apiAuth).toContain('liveSession.lastSeenAt.getTime() <= now.getTime() - ADMIN_IDLE_TIMEOUT_MS')
    expect(controls).not.toContain('resetIdleTimer()')
  })
})
