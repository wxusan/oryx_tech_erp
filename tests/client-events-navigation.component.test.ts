// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { navigateAfterMutation, subscribeToLocalNavigationMutationImpacts } from '@/lib/client-events'
import { registerIncrementalSyncRunner } from '@/lib/client-sync-runtime'

describe('mutation navigation latency', () => {
  let unregister: (() => void) | undefined

  afterEach(() => unregister?.())

  it('applies local impact and pushes the route before durable sync settles', async () => {
    let releaseSync!: () => void
    const sync = new Promise<string | null>((resolve) => {
      releaseSync = () => resolve('9')
    })
    unregister = registerIncrementalSyncRunner('SHOP_ADMIN:shop-a:1', () => sync, () => {}, () => {})
    const order: string[] = []
    const unsubscribe = subscribeToLocalNavigationMutationImpacts(() => order.push('impact'))

    const navigation = navigateAfterMutation(
      { push: () => order.push('push'), refresh: () => {} },
      '/shop/qurilmalar',
      { kind: 'device.created', deviceId: 'device-a' },
    )

    expect(order).toEqual(['impact', 'push'])
    releaseSync()
    await navigation
    unsubscribe()
  })
})
