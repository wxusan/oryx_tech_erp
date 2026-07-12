'use client'

type SyncRunner = () => Promise<string | null>

let activeRunner: SyncRunner | null = null
let activeScopeKey: string | null = null
let clearActiveCache: (() => void) | null = null
let adoptActiveCursor: ((cursor: string) => void) | null = null

export function registerIncrementalSyncRunner(
  scopeKey: string,
  runner: SyncRunner,
  clearCache: () => void,
  adoptCursor: (cursor: string) => void,
) {
  activeRunner = runner
  activeScopeKey = scopeKey
  clearActiveCache = clearCache
  adoptActiveCursor = adoptCursor
  return () => {
    if (activeRunner === runner) {
      activeRunner = null
      activeScopeKey = null
      clearActiveCache = null
      adoptActiveCursor = null
    }
  }
}

export async function requestIncrementalSync() {
  return activeRunner ? activeRunner() : null
}

export function activeIncrementalSyncScopeKey() {
  return activeScopeKey
}

export function clearActiveAuthenticatedQueryCache() {
  clearActiveCache?.()
}

export function adoptIncrementalSnapshotCursor(cursor: string) {
  adoptActiveCursor?.(cursor)
}
