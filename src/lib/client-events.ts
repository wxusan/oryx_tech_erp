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

/** Call only after the API mutation has returned a confirmed success. */
export async function commitNavigationMutation(mutation: NavigationMutation) {
  const scopeKey = activeIncrementalSyncScopeKey()
  if (!scopeKey) return false
  const impact = navigationImpactForMutation(mutation)
  dispatchSuccessfulMutation(mutation, impact)
  const cursor = await requestIncrementalSync()
  const message: NavigationMutationBroadcast = {
    id: mutationId(),
    sourceId: navigationClientInstanceId(),
    scopeKey,
    mutation,
    createdAt: Date.now(),
    cursor,
  }
  broadcastSuccessfulMutation(message)
  return true
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
  await commitNavigationMutation(mutation)
  router.push(href)
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
