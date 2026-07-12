'use client'

import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { patchDeviceDelete, patchDeviceUpsert } from '@/lib/device-query-cache'
import { queryKeys } from '@/lib/query-keys'
import { registerIncrementalSyncRunner } from '@/lib/client-sync-runtime'
import { useAuthenticatedQueryScope } from '@/components/query-scope-context'
import type { IncrementalSyncResponse } from '@/lib/sync-contract'
import {
  navigationClientInstanceId,
  subscribeToNavigationMutations,
  type NavigationMutationBroadcast,
} from '@/lib/client-events'

const SYNC_INTERVAL_MS = 25_000
const MAX_BACKOFF_MS = 120_000

export function NavigationCacheCoordinator({
  scopeKey,
  initialCursor,
}: {
  scopeKey: string
  initialCursor: string
}) {
  const queryClient = useQueryClient()
  const scope = useAuthenticatedQueryScope()
  const router = useRouter()
  const cursorRef = useRef(initialCursor)
  const runningRef = useRef<Promise<string | null> | null>(null)
  const controllerRef = useRef<AbortController | null>(null)
  const failureCountRef = useRef(0)
  const nextAllowedAtRef = useRef(0)
  const [showSyncing, setShowSyncing] = useState(false)

  useEffect(() => {
    let disposed = false
    let slowTimer: number | null = null
    const sourceId = navigationClientInstanceId()

    function applyDelta(delta: IncrementalSyncResponse) {
      for (const device of delta.upserts.devices) patchDeviceUpsert(queryClient, scope, device)
      for (const tombstone of delta.tombstones) {
        if (tombstone.entityType === 'Device') patchDeviceDelete(queryClient, scope, tombstone.entityId)
      }

      // Query-backed domains keep their existing data visible while only the
      // affected active query revalidates. Device lists are patched precisely
      // above and therefore do not need a broad refetch.
      for (const domain of delta.invalidatedDomains) {
        if (domain === 'devices') continue
        void queryClient.invalidateQueries({
          queryKey: queryKeys.domain(scope, domain),
          refetchType: 'active',
        })
      }
    }

    async function executeSync(): Promise<string | null> {
      if (disposed || document.visibilityState !== 'visible') return cursorRef.current
      if (Date.now() < nextAllowedAtRef.current) return null
      controllerRef.current?.abort()
      const controller = new AbortController()
      controllerRef.current = controller
      slowTimer = window.setTimeout(() => setShowSyncing(true), 500)

      try {
        let hasMore = true
        let cursor = cursorRef.current
        while (hasMore && !disposed) {
          const response = await fetch(`/api/sync?cursor=${encodeURIComponent(cursor)}`, {
            cache: 'no-store',
            credentials: 'same-origin',
            signal: controller.signal,
          })
          if (response.status === 401 || response.status === 403) {
            queryClient.clear()
            window.location.reload()
            return null
          }
          if (!response.ok) throw new Error(`SYNC_${response.status}`)
          const delta = await response.json() as IncrementalSyncResponse
          if (delta.resetRequired) {
            queryClient.clear()
            router.refresh()
            cursorRef.current = delta.nextCursor
            return delta.nextCursor
          }
          applyDelta(delta)
          cursor = delta.nextCursor
          cursorRef.current = cursor
          hasMore = delta.hasMore
        }
        failureCountRef.current = 0
        nextAllowedAtRef.current = 0
        return cursorRef.current
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return null
        failureCountRef.current += 1
        nextAllowedAtRef.current = Date.now() + Math.min(
          SYNC_INTERVAL_MS * 2 ** (failureCountRef.current - 1),
          MAX_BACKOFF_MS,
        )
        return null
      } finally {
        if (slowTimer != null) window.clearTimeout(slowTimer)
        slowTimer = null
        if (!disposed) setShowSyncing(false)
        if (controllerRef.current === controller) controllerRef.current = null
      }
    }

    function runSync() {
      if (runningRef.current) return runningRef.current
      const promise = executeSync().finally(() => {
        if (runningRef.current === promise) runningRef.current = null
      })
      runningRef.current = promise
      return promise
    }

    const unregisterRunner = registerIncrementalSyncRunner(
      scopeKey,
      runSync,
      () => queryClient.clear(),
      (cursor) => {
        if (BigInt(cursor) < BigInt(cursorRef.current)) cursorRef.current = cursor
      },
    )
    const receive = (message: NavigationMutationBroadcast) => {
      if (message.sourceId === sourceId || message.scopeKey !== scopeKey) return
      void runSync()
    }
    const unsubscribe = subscribeToNavigationMutations(receive)
    const visibleSync = () => {
      if (document.visibilityState === 'visible') void runSync()
    }
    const interval = window.setInterval(visibleSync, SYNC_INTERVAL_MS)
    window.addEventListener('focus', visibleSync)
    window.addEventListener('online', visibleSync)
    document.addEventListener('visibilitychange', visibleSync)

    return () => {
      disposed = true
      if (slowTimer != null) window.clearTimeout(slowTimer)
      controllerRef.current?.abort()
      unregisterRunner()
      unsubscribe()
      window.clearInterval(interval)
      window.removeEventListener('focus', visibleSync)
      window.removeEventListener('online', visibleSync)
      document.removeEventListener('visibilitychange', visibleSync)
    }
  }, [queryClient, router, scope, scopeKey])

  if (!showSyncing) return null
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-3 right-3 z-50 rounded-full border border-zinc-200 bg-white/95 px-3 py-1.5 text-xs text-zinc-500 shadow-sm"
    >
      Sinxronlanmoqda…
    </div>
  )
}
