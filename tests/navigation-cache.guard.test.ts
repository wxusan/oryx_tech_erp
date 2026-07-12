import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function read(path: string) {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

describe('navigation cache integration guards', () => {
  it('configures a 30-second Client Router Cache for navigated and targeted-prefetch routes', () => {
    const config = read('next.config.ts')
    expect(config).toContain('staleTimes: { dynamic: 30, static: 30 }')
  })

  it('authenticates the Server Action, revalidates typed paths, then refreshes the current route', () => {
    const action = read('src/app/actions/navigation-cache.ts')
    expect(action).toContain('await requireApiSession()')
    expect(action).toContain('navigationImpactForMutation(mutation)')
    expect(action).toContain('for (const path of impact.paths)')
    expect(action).toContain('revalidatePath(path)')
    expect(action).toContain('refresh()')
  })

  it('emits and broadcasts only after successful Server Action invalidation', () => {
    const events = read('src/lib/client-events.ts')
    const action = events.indexOf('await invalidateNavigationAfterMutation(mutation)')
    const dispatch = events.indexOf('dispatchSuccessfulMutation(mutation, result.impact)')
    expect(action).toBeGreaterThan(0)
    expect(dispatch).toBeGreaterThan(action)
    expect(events).toContain('catch {\n    return false')
  })

  it('uses narrow hard-navigation fallbacks and clears client state at logout', () => {
    const events = read('src/lib/client-events.ts')
    const session = read('src/components/auth/session-controls.tsx')
    expect(events).toContain('else window.location.assign(href)')
    expect(events).toContain('else window.location.reload()')
    expect(session).toContain('clearNavigationClientState()')
    expect(session).toContain('signOut({ callbackUrl })')
  })

  it('coordinates cross-tab, focus, visibility, reconnect, dedupe, and scope isolation', () => {
    const coordinator = read('src/components/navigation-cache-coordinator.tsx')
    expect(coordinator).toContain("window.addEventListener('focus'")
    expect(coordinator).toContain("window.addEventListener('online'")
    expect(coordinator).toContain("document.addEventListener('visibilitychange'")
    expect(coordinator).toContain('message.scopeKey !== scopeKey')
    expect(coordinator).toContain('message.sourceId === sourceId')
    expect(coordinator).toContain('seenRef.current.has(message.id)')
    expect(coordinator).toContain('refreshQueuedRef.current = true')
  })

  it('wires every client operational-mutation module to the central contract', () => {
    const mutationFiles = [
      'src/app/(admin)/admin/settings/settings-client.tsx',
      'src/app/(admin)/admin/shops/[id]/page.tsx',
      'src/app/(admin)/admin/shops/new/page.tsx',
      'src/app/(shop)/shop/mijozlar/customers-client.tsx',
      'src/app/(shop)/shop/nasiyalar/[id]/page.tsx',
      'src/app/(shop)/shop/nasiyalar/import/page.tsx',
      'src/app/(shop)/shop/nasiyalar/new/page.tsx',
      'src/app/(shop)/shop/olib-sotdim/new/page.tsx',
      'src/app/(shop)/shop/olib-sotdim/olib-sotdim-client.tsx',
      'src/app/(shop)/shop/qurilmalar/[id]/page.tsx',
      'src/app/(shop)/shop/qurilmalar/new/page.tsx',
      'src/app/(shop)/shop/settings/page.tsx',
      'src/app/(shop)/shop/sotuv/new/page.tsx',
      'src/components/shop/nasiya-payment-modal.tsx',
    ]
    for (const path of mutationFiles) expect(read(path), path).toContain("@/lib/client-events")
  })

  it('prefetches expensive details only after hover/focus/touch intent', () => {
    const link = read('src/components/intent-prefetch-link.tsx')
    expect(link).toContain('prefetch={intent ? null : false}')
    expect(link).toContain('setTimeout(() => setIntent(true), intentDelayMs)')
    expect(link).toContain('onFocus')
    expect(link).toContain('onTouchStart')
    expect(read('src/app/(shop)/shop/qurilmalar/qurilmalar-client.tsx')).not.toContain('prefetch={false}')
    expect(read('src/app/(shop)/shop/nasiyalar/nasiyalar-client.tsx')).not.toContain('prefetch={false}')
  })

  it('stores device, nasiya, customer, logs, and olib-sotdim list state in the URL', () => {
    for (const path of [
      'src/app/(shop)/shop/qurilmalar/qurilmalar-client.tsx',
      'src/app/(shop)/shop/nasiyalar/nasiyalar-client.tsx',
      'src/app/(shop)/shop/mijozlar/customers-client.tsx',
      'src/app/(shop)/shop/logs/logs-client.tsx',
      'src/app/(shop)/shop/olib-sotdim/olib-sotdim-client.tsx',
    ]) {
      expect(read(path), path).toContain('replaceListUrlState')
    }
  })

  it('cancels or generation-guards stale list responses', () => {
    expect(read('src/app/(shop)/shop/qurilmalar/qurilmalar-client.tsx')).toContain('controller.abort()')
    expect(read('src/app/(shop)/shop/nasiyalar/nasiyalar-client.tsx')).toContain('controller.abort()')
    expect(read('src/app/(shop)/shop/logs/logs-client.tsx')).toContain('controller.abort()')
    expect(read('src/app/(shop)/shop/mijozlar/customers-client.tsx')).toContain('requestGenerationRef')
    expect(read('src/app/(shop)/shop/olib-sotdim/olib-sotdim-client.tsx')).toContain('requestGenerationRef')
  })
})
