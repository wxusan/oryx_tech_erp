'use client'

import { navigationImpactForMutation, type NavigationImpact, type NavigationMutation } from '@/lib/navigation-cache-policy'
import {
  activeIncrementalSyncScopeKey,
  clearActiveAuthenticatedQueryCache,
  requestIncrementalSync,
} from '@/lib/client-sync-runtime'

export const FINANCIAL_DATA_CHANGED_EVENT = 'oryx:financial-data-changed'
export const NAVIGATION_MUTATION_EVENT = 'oryx:navigation-mutation'
export const NAVIGATION_LOGOUT_EVENT = 'oryx:navigation-logout'
const BROADCAST_CHANNEL_NAME = 'oryx:navigation-cache:v1'
const STORAGE_EVENT_KEY = 'oryx:last-navigation-mutation'

export interface NavigationMutationBroadcast {
  id: string
  sourceId: string
  scopeKey: string
  mutation: NavigationMutation
  createdAt: number
  cursor?: string | null
}

export interface NavigationMutationEventDetail {
  mutation: NavigationMutation
  impact: NavigationImpact
}

let clientInstanceId: string | null = null

function mutationId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function navigationClientInstanceId() {
  clientInstanceId ??= mutationId()
  return clientInstanceId
}

function dispatchSuccessfulMutation(mutation: NavigationMutation, impact: NavigationImpact) {
  window.dispatchEvent(new CustomEvent(NAVIGATION_MUTATION_EVENT, { detail: { mutation, impact } }))
  if (impact.domains.some((domain) => ['sales', 'nasiyas', 'payments', 'returns', 'overdue', 'currency'].includes(domain))) {
    window.dispatchEvent(new Event(FINANCIAL_DATA_CHANGED_EVENT))
  }
}

function broadcastSuccessfulMutation(message: NavigationMutationBroadcast) {
  if ('BroadcastChannel' in window) {
    const channel = new BroadcastChannel(BROADCAST_CHANNEL_NAME)
    channel.postMessage(message)
    channel.close()
  }
  try {
    window.localStorage.setItem(STORAGE_EVENT_KEY, JSON.stringify(message))
  } catch {
    // Restricted/private contexts may not expose localStorage.
  }
}

/**
 * Call only after the API mutation has returned a confirmed success.
 *
 * Local invalidation and cross-tab notification are synchronous. Durable
 * `/api/sync` reconciliation intentionally continues in the background so a
 * slow read model can never hold a confirmed financial dialog open.
 */
export function commitNavigationMutation(mutation: NavigationMutation): Promise<boolean> {
  const scopeKey = activeIncrementalSyncScopeKey()
  if (!scopeKey) return Promise.resolve(false)
  const impact = navigationImpactForMutation(mutation)
  dispatchSuccessfulMutation(mutation, impact)
  const message: NavigationMutationBroadcast = {
    id: mutationId(),
    sourceId: navigationClientInstanceId(),
    scopeKey,
    mutation,
    createdAt: Date.now(),
  }
  broadcastSuccessfulMutation(message)
  const syncMark = `oryx:client-sync:${message.id}`
  const canMeasureSync = typeof performance !== 'undefined'
    && typeof performance.mark === 'function'
    && typeof performance.measure === 'function'
    && typeof performance.clearMarks === 'function'
  if (canMeasureSync) performance.mark(syncMark)
  void requestIncrementalSync().finally(() => {
    if (!canMeasureSync) return
    try {
      performance.measure('oryx:client-sync', syncMark)
    } catch {
      // User Timing is observability only; it must not affect reconciliation.
    } finally {
      performance.clearMarks(syncMark)
    }
  })
  return Promise.resolve(true)
}

export interface NavigationRouter {
  push(href: string): void
  refresh(): void
}

export async function navigateAfterMutation(
  router: NavigationRouter,
  href: string,
  mutation: NavigationMutation,
) {
  // Local targeted invalidation happens synchronously before the commit's
  // first await. Start the durable sync/broadcast work, navigate immediately,
  // and only then await completion so a slow /api/sync cannot hold the UI.
  const commit = commitNavigationMutation(mutation)
  router.push(href)
  await commit
}

export async function refreshAfterMutation(router: NavigationRouter, mutation: NavigationMutation) {
  await commitNavigationMutation(mutation)
}

export function subscribeToNavigationMutations(listener: (message: NavigationMutationBroadcast) => void) {
  const channel = 'BroadcastChannel' in window ? new BroadcastChannel(BROADCAST_CHANNEL_NAME) : null
  const channelListener = (event: MessageEvent<NavigationMutationBroadcast>) => listener(event.data)
  const storageListener = (event: StorageEvent) => {
    if (event.key !== STORAGE_EVENT_KEY || !event.newValue) return
    try {
      listener(JSON.parse(event.newValue) as NavigationMutationBroadcast)
    } catch {
      // Ignore malformed/legacy localStorage values.
    }
  }
  channel?.addEventListener('message', channelListener)
  window.addEventListener('storage', storageListener)
  return () => {
    channel?.removeEventListener('message', channelListener)
    channel?.close()
    window.removeEventListener('storage', storageListener)
  }
}

export function subscribeToLocalNavigationMutationImpacts(
  listener: (detail: NavigationMutationEventDetail) => void,
) {
  const eventListener = (event: Event) => {
    const detail = (event as CustomEvent<NavigationMutationEventDetail>).detail
    if (!detail?.mutation || !detail.impact) return
    listener(detail)
  }
  window.addEventListener(NAVIGATION_MUTATION_EVENT, eventListener)
  return () => window.removeEventListener(NAVIGATION_MUTATION_EVENT, eventListener)
}

export function clearNavigationClientState() {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(STORAGE_EVENT_KEY)
  } catch {
    // Restricted/private contexts may not expose localStorage.
  }
  clearActiveAuthenticatedQueryCache()
  window.dispatchEvent(new Event(NAVIGATION_LOGOUT_EVENT))
}
