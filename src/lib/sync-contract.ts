import type { DeviceListItem } from '@/lib/device-list-contract'
import { navigationDomains, type NavigationDomain } from '@/lib/navigation-cache-policy'

export interface SyncEvent {
  cursor: string
  domain: NavigationDomain
  entityType: string
  entityId: string
  operation: 'created' | 'updated' | 'deleted' | 'aggregate-invalidated'
  mutationKind: string
  entityVersion: string
  affectedDomains: NavigationDomain[]
}

export interface IncrementalSyncResponse {
  nextCursor: string
  hasMore: boolean
  resetRequired: boolean
  events: SyncEvent[]
  upserts: {
    devices: DeviceListItem[]
  }
  tombstones: Array<{ entityType: string; entityId: string }>
  invalidatedDomains: NavigationDomain[]
}

export function emptyIncrementalSyncResponse(nextCursor: string): IncrementalSyncResponse {
  return {
    nextCursor,
    hasMore: false,
    resetRequired: false,
    events: [],
    upserts: { devices: [] },
    tombstones: [],
    invalidatedDomains: [],
  }
}

/** Keep only the latest event for an entity within one ordered cursor batch. */
export function coalesceSyncEvents(events: readonly SyncEvent[]): SyncEvent[] {
  const latestByEntity = new Map<string, SyncEvent>()
  for (const event of events) latestByEntity.set(`${event.entityType}:${event.entityId}`, event)
  return [...latestByEntity.values()].sort((left, right) => {
    const leftCursor = BigInt(left.cursor)
    const rightCursor = BigInt(right.cursor)
    return leftCursor < rightCursor ? -1 : leftCursor > rightCursor ? 1 : 0
  })
}

/**
 * A cursor is expired only when it predates the oldest retained event in the
 * same authorized scope/domain stream. Global sequence gaps are expected
 * because other tenants share the sequence and must never force a reset.
 */
export function scopedCursorResetRequired(cursor: bigint, scopedOldest: bigint | null) {
  return cursor > BigInt(0) && scopedOldest != null && cursor < scopedOldest
}

export function parseSyncCursor(value: string | null): bigint | null {
  if (value == null || value === '') return null
  if (!/^\d+$/.test(value)) throw new Error('INVALID_SYNC_CURSOR')
  const cursor = BigInt(value)
  if (cursor < BigInt(0)) throw new Error('INVALID_SYNC_CURSOR')
  return cursor
}

export function parseNavigationDomains(value: string | null): NavigationDomain[] | undefined {
  if (value == null || value.trim() === '') return undefined
  const allowed = new Set<string>(navigationDomains)
  const domains = [...new Set(value.split(',').map((domain) => domain.trim()).filter(Boolean))]
  if (!domains.length || domains.some((domain) => !allowed.has(domain))) {
    throw new Error('INVALID_SYNC_DOMAINS')
  }
  return domains as NavigationDomain[]
}
