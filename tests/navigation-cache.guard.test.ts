import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function read(path: string) {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

describe('navigation cache integration guards', () => {
  it('configures a two-minute Client Router Cache for navigated and targeted-prefetch routes', () => {
    const config = read('next.config.ts')
    expect(config).toContain('staleTimes: { dynamic: 120, static: 120 }')
  })

  it('authenticates private delta sync and derives the tenant scope server-side', () => {
    const route = read('src/app/api/sync/route.ts')
    expect(route).toContain('await requireApiSession()')
    expect(route).toContain("'Cache-Control': 'private, no-store, max-age=0'")
    expect(route).not.toContain("searchParams.get('shopId')")
    expect(read('prisma/migrations/202607120001_incremental_change_events/migration.sql')).toContain('AFTER INSERT ON "Log"')
  })

  it('synchronizes, then broadcasts without a cache-clearing Server Action', () => {
    const events = read('src/lib/client-events.ts')
    expect(events).toContain('await requestIncrementalSync()')
    expect(events).toContain('broadcastSuccessfulMutation(message)')
    expect(events).not.toContain('invalidateNavigationAfterMutation')
    expect(events).not.toContain('window.location.assign(href)')
  })

  it('clears both query and cross-tab state at logout', () => {
    const events = read('src/lib/client-events.ts')
    const session = read('src/components/auth/session-controls.tsx')
    expect(events).toContain('clearActiveAuthenticatedQueryCache()')
    expect(session).toContain('clearNavigationClientState()')
    expect(session).toContain('signOut({ callbackUrl })')
  })

  it('coordinates cross-tab, polling, focus, visibility, reconnect, backoff, and scope isolation', () => {
    const coordinator = read('src/components/navigation-cache-coordinator.tsx')
    expect(coordinator).toContain("window.addEventListener('focus'")
    expect(coordinator).toContain("window.addEventListener('online'")
    expect(coordinator).toContain("document.addEventListener('visibilitychange'")
    expect(coordinator).toContain('message.scopeKey !== scopeKey')
    expect(coordinator).toContain('message.sourceId === sourceId')
    expect(coordinator).toContain('window.setInterval(visibleSync, SYNC_INTERVAL_MS)')
    expect(coordinator).toContain('nextAllowedAtRef.current')
    expect(coordinator).toContain('runningRef.current')
    expect(coordinator).toContain('navigationImpactForMutation(message.mutation)')
    expect(coordinator).toContain('subscribeToLocalNavigationMutationImpacts')
    expect(coordinator).toContain('invalidateNavigationQueryDomains(queryClient, scope, impact.domains)')
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

  it('uses TanStack query signals and previous-data retention for operational lists', () => {
    for (const path of [
      'src/app/(shop)/shop/qurilmalar/qurilmalar-client.tsx',
      'src/app/(shop)/shop/nasiyalar/nasiyalar-client.tsx',
      'src/app/(shop)/shop/logs/logs-client.tsx',
      'src/app/(shop)/shop/mijozlar/customers-client.tsx',
      'src/app/(shop)/shop/olib-sotdim/olib-sotdim-client.tsx',
    ]) {
      const source = read(path)
      expect(source, path).toContain('useQuery({')
      expect(source, path).toContain('signal')
      expect(source, path).toContain('placeholderData: keepPreviousData')
    }
  })
})
