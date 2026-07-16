import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function read(path: string) {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

describe('nasiya operation context performance contract', () => {
  it('uses a narrow, permission-scoped private DTO instead of full nasiya detail', () => {
    const route = read('src/app/api/nasiya/[id]/operation-context/route.ts')
    expect(route).toContain('requireShopPermissionAndFeature(')
    expect(route).toContain("'NASIYA_PAYMENT_RECEIVE'")
    expect(route).toContain("'NASIYA_DEFER'")
    expect(route).toContain("response.headers.set('Cache-Control', 'private, no-store, max-age=0')")
    expect(route).toContain('paymentAllocations:')
    expect(route).not.toContain('nasiyaResolutionEvent')
    expect(route).not.toContain('getShopCurrencyContext')
    expect(route).not.toContain('payments:')
  })

  it('keeps dialog context cache keys isolated by session, permission, and package scope', () => {
    const keys = read('src/lib/query-keys.ts')
    expect(keys).toContain('scope.packageVersionId')
    expect(keys).toContain("'operation-context', id, intent")

    const queryScope = read('src/lib/query-scope.ts')
    expect(queryScope).toContain('authorizationVersion')
    expect(queryScope).toContain('permissionVersion')
    expect(queryScope).toContain('packageVersionId')
  })

  it('uses the scoped context for both dialogs, patches confirmed responses, and backgrounds sync', () => {
    const payment = read('src/components/shop/nasiya-payment-modal.tsx')
    const defer = read('src/components/shop/nasiya-defer-modal.tsx')
    expect(payment).toContain("intent: 'payment'")
    expect(payment).toContain('queryClient.setQueryData<NasiyaOperationContext>')
    expect(payment).toContain('void commitNavigationMutation')
    expect(payment).not.toContain('fetch(`/api/nasiya/${nasiyaId}`)')
    expect(defer).toContain("intent: 'defer'")
    expect(defer).toContain('queryClient.setQueryData<NasiyaOperationContext>')
    expect(defer).toContain('void commitNavigationMutation')
    expect(defer).not.toContain('fetch(`/api/nasiya/${nasiyaId}`)')
  })

  it('does not block the authenticated shell on receivable aggregation', () => {
    const layout = read('src/app/(shop)/layout.tsx')
    const banner = read('src/components/shop/due-overdue-banner.tsx')
    expect(layout).not.toContain('getReceivableCohortSummaries')
    expect(banner).toContain("fetch('/api/stats/due-overdue'")
  })

  it('keeps financial notification writes set-based and emits opt-in/slow timing phases', () => {
    const paymentRoute = read('src/app/api/nasiya/[id]/payment/route.ts')
    expect(paymentRoute).toContain('tx.notification.createMany({ data: notificationRows })')
    for (const phase of [
      'authenticationPermissions',
      'rateLimiter',
      'initialDatabaseReads',
      'currencyFx',
      'allocationLedgerReconciliation',
      'notificationsAudit',
      'serializableTransaction',
      'serialization',
    ]) {
      expect(paymentRoute).toContain(phase)
    }
  })
})
