'use client'

import { useEffect, useRef } from 'react'
import { refreshAuthenticatedNavigation } from '@/app/actions/navigation-cache'
import {
  NAVIGATION_CACHE_TTL_MS,
  type NavigationMutation,
} from '@/lib/navigation-cache-policy'
import {
  NAVIGATION_MUTATION_EVENT,
  navigationClientInstanceId,
  subscribeToNavigationMutations,
  type NavigationMutationBroadcast,
} from '@/lib/client-events'

export function NavigationCacheCoordinator({ scopeKey }: { scopeKey: string }) {
  const lastFreshAtRef = useRef(0)
  const refreshRunningRef = useRef(false)
  const refreshQueuedRef = useRef(false)
  const seenRef = useRef(new Set<string>())

  useEffect(() => {
    lastFreshAtRef.current = Date.now()
    const sourceId = navigationClientInstanceId()

    async function refreshNow() {
      if (refreshRunningRef.current) {
        refreshQueuedRef.current = true
        return
      }
      refreshRunningRef.current = true
      try {
        const result = await refreshAuthenticatedNavigation()
        if (result.scopeKey !== scopeKey) {
          window.location.reload()
          return
        }
        lastFreshAtRef.current = Date.now()
      } catch {
        // A revoked/changed session must be rechecked by a real document request.
        window.location.reload()
      } finally {
        refreshRunningRef.current = false
        if (refreshQueuedRef.current) {
          refreshQueuedRef.current = false
          void refreshNow()
        }
      }
    }

    function receive(message: NavigationMutationBroadcast) {
      if (message.sourceId === sourceId || message.scopeKey !== scopeKey || seenRef.current.has(message.id)) return
      seenRef.current.add(message.id)
      if (seenRef.current.size > 100) {
        const first = seenRef.current.values().next().value
        if (first) seenRef.current.delete(first)
      }
      void refreshNow()
    }

    const unsubscribe = subscribeToNavigationMutations(receive)
    const localMutation = () => {
      lastFreshAtRef.current = Date.now()
    }
    const refreshIfStale = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastFreshAtRef.current >= NAVIGATION_CACHE_TTL_MS) {
        void refreshNow()
      }
    }

    window.addEventListener(NAVIGATION_MUTATION_EVENT, localMutation)
    window.addEventListener('focus', refreshIfStale)
    window.addEventListener('online', refreshIfStale)
    document.addEventListener('visibilitychange', refreshIfStale)
    return () => {
      unsubscribe()
      window.removeEventListener(NAVIGATION_MUTATION_EVENT, localMutation)
      window.removeEventListener('focus', refreshIfStale)
      window.removeEventListener('online', refreshIfStale)
      document.removeEventListener('visibilitychange', refreshIfStale)
    }
  }, [scopeKey])

  return null
}

export type { NavigationMutation }
