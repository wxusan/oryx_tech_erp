import { describe, expect, it } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import type { DeviceListItem, DeviceListPage } from '@/lib/device-list-contract'
import { deviceMatchesListQuery, patchDeviceDelete, patchDeviceUpsert } from '@/lib/device-query-cache'
import { queryKeys, type DeviceListQuery } from '@/lib/query-keys'
import { authenticatedQueryScope } from '@/lib/query-scope'
import {
  coalesceSyncEvents,
  emptyIncrementalSyncResponse,
  parseNavigationDomains,
  parseSyncCursor,
  scopedCursorResetRequired,
  type SyncEvent,
} from '@/lib/sync-contract'
import { entityStructuralSharing } from '@/lib/query-structural-sharing'
import { createAuthenticatedQueryClient } from '@/components/authenticated-query-provider'

const scopeA = authenticatedQueryScope({ id: 'admin-a', role: 'SHOP_ADMIN', shopId: 'shop-a', sessionVersion: 2 })
const scopeB = authenticatedQueryScope({ id: 'admin-b', role: 'SHOP_ADMIN', shopId: 'shop-b', sessionVersion: 2 })
const baseQuery: DeviceListQuery = { search: '', status: 'Barchasi', page: 1, take: 2, sort: 'createdAt-desc' }

function device(id: string, overrides: Partial<DeviceListItem> = {}): DeviceListItem {
  return {
    id,
    model: `Phone ${id}`,
    color: 'Black',
    storage: '128',
    storageAmount: null,
    storageUnit: null,
    storageDisplay: '128',
    conditionCode: null,
    conditionLabel: 'Belgilanmagan',
    batteryHealth: 90,
    purchasePrice: 100,
    imei: id.padEnd(15, '0'),
    primaryImei: id.padEnd(15, '0'),
    secondaryImei: null,
    status: 'IN_STOCK',
    createdAt: `2026-07-${id.padStart(2, '0')}T00:00:00.000Z`,
    note: null,
    supplierName: null,
    supplierPhone: null,
    saleInfo: null,
    ...overrides,
  }
}

function page(items: DeviceListItem[], total = items.length): DeviceListPage {
  return { items, total, skip: 0, take: 2 }
}

describe('authenticated query keys', () => {
  it('isolates tenant, role, session version, filters, and page', () => {
    expect(queryKeys.devices.list(scopeA, baseQuery)).not.toEqual(queryKeys.devices.list(scopeB, baseQuery))
    expect(queryKeys.devices.list(scopeA, baseQuery)).not.toEqual(
      queryKeys.devices.list({ ...scopeA, sessionVersion: 3 }, baseQuery),
    )
    expect(queryKeys.devices.list(scopeA, baseQuery)).not.toEqual(
      queryKeys.devices.list({ ...scopeA, authorizationVersion: 3 }, baseQuery),
    )
    expect(queryKeys.devices.list(scopeA, baseQuery)).not.toEqual(
      queryKeys.devices.list({ ...scopeA, permissionVersion: 2 }, baseQuery),
    )
    expect(queryKeys.nasiyas.operationContext(scopeA, 'nasiya-1', 'payment')).not.toEqual(
      queryKeys.nasiyas.operationContext({ ...scopeA, packageVersionId: 'package-2' }, 'nasiya-1', 'payment'),
    )
    expect(queryKeys.nasiyas.operationContext(scopeA, 'nasiya-1', 'payment')).not.toEqual(
      queryKeys.nasiyas.operationContext(scopeA, 'nasiya-1', 'defer'),
    )
    expect(queryKeys.devices.list(scopeA, baseQuery)).not.toEqual(
      queryKeys.devices.list(scopeA, { ...baseQuery, page: 2 }),
    )
    expect(queryKeys.devices.list(scopeA, baseQuery)).not.toEqual(
      queryKeys.devices.list(scopeA, { ...baseQuery, status: 'SOLD_CASH' }),
    )
  })

  it('uses the bounded authenticated cache policy and clears all tenant data', () => {
    const client = createAuthenticatedQueryClient()
    const defaults = client.getDefaultOptions()
    expect(defaults.queries?.staleTime).toBe(120_000)
    expect(defaults.queries?.gcTime).toBe(30 * 60_000)
    expect(defaults.queries?.retry).toBe(1)
    client.setQueryData(queryKeys.domain(scopeA, 'customers'), { sensitive: true })
    client.clear()
    expect(client.getQueryCache().getAll()).toHaveLength(0)
  })
})

describe('device query membership and structural patching', () => {
  it('matches status and all canonical searchable fields', () => {
    const item = device('1', { supplierName: 'Malika Trade', supplierPhone: '+998901234567' })
    expect(deviceMatchesListQuery(item, { ...baseQuery, search: 'malika' })).toBe(true)
    expect(deviceMatchesListQuery(item, { ...baseQuery, search: '1234567' })).toBe(true)
    expect(deviceMatchesListQuery(item, { ...baseQuery, status: 'SOLD_CASH' })).toBe(false)
  })

  it('prepends a create, preserves the page boundary, and keeps unchanged references', () => {
    const client = new QueryClient({ defaultOptions: { queries: { structuralSharing: entityStructuralSharing } } })
    const first = device('1')
    const second = device('2')
    const key = queryKeys.devices.list(scopeA, baseQuery)
    client.setQueryData(key, page([second, first], 2))
    const unchangedCachedReference = client.getQueryData<DeviceListPage>(key)!.items[0]
    const created = device('3')
    patchDeviceUpsert(client, scopeA, created)
    const next = client.getQueryData<DeviceListPage>(key)!
    expect(next.items.map((item) => item.id)).toEqual(['3', '2'])
    expect(next.items[1]).toBe(unchangedCachedReference)
    expect(next.total).toBe(3)
  })

  it('moves an updated row out of a status query without touching another shop', () => {
    const client = new QueryClient()
    const stockQuery = { ...baseQuery, status: 'IN_STOCK' as const }
    const keyA = queryKeys.devices.list(scopeA, stockQuery)
    const keyB = queryKeys.devices.list(scopeB, stockQuery)
    const row = device('1')
    client.setQueryData(keyA, page([row], 1))
    client.setQueryData(keyB, page([row], 1))
    patchDeviceUpsert(client, scopeA, { ...row, status: 'SOLD_CASH' })
    expect(client.getQueryData<DeviceListPage>(keyA)?.items).toEqual([])
    expect(client.getQueryData<DeviceListPage>(keyB)?.items).toEqual([row])
  })

  it('applies a tombstone idempotently', () => {
    const client = new QueryClient()
    const key = queryKeys.devices.list(scopeA, baseQuery)
    client.setQueryData(key, page([device('1'), device('2')], 2))
    patchDeviceDelete(client, scopeA, '1')
    patchDeviceDelete(client, scopeA, '1')
    expect(client.getQueryData<DeviceListPage>(key)?.items.map((item) => item.id)).toEqual(['2'])
    expect(client.getQueryData<DeviceListPage>(key)?.total).toBe(1)
  })
})

describe('sync cursor contract', () => {
  it('accepts non-negative decimal cursors and rejects malformed values', () => {
    expect(parseSyncCursor(null)).toBeNull()
    expect(parseSyncCursor('0')).toBe(BigInt(0))
    expect(parseSyncCursor('123')).toBe(BigInt(123))
    expect(() => parseSyncCursor('-1')).toThrow('INVALID_SYNC_CURSOR')
    expect(() => parseSyncCursor('1.5')).toThrow('INVALID_SYNC_CURSOR')
    expect(() => parseSyncCursor('abc')).toThrow('INVALID_SYNC_CURSOR')
  })

  it('accepts only known, deduplicated synchronization domains', () => {
    expect(parseNavigationDomains(null)).toBeUndefined()
    expect(parseNavigationDomains('devices,reports,devices')).toEqual(['devices', 'reports'])
    expect(() => parseNavigationDomains('devices,other-shop')).toThrow('INVALID_SYNC_DOMAINS')
  })

  it('keeps a no-change payload comfortably below one kilobyte', () => {
    const bytes = new TextEncoder().encode(JSON.stringify(emptyIncrementalSyncResponse('123456789'))).byteLength
    expect(bytes).toBeLessThan(1_000)
  })

  it('coalesces repeated entity changes to the latest ordered event', () => {
    const event = (cursor: string, operation: SyncEvent['operation'], entityId = 'device-1'): SyncEvent => ({
      cursor,
      domain: 'devices',
      entityType: 'Device',
      entityId,
      operation,
      mutationKind: `device.${operation}`,
      entityVersion: '2026-07-12T00:00:00.000Z',
      affectedDomains: ['devices'],
    })
    expect(coalesceSyncEvents([event('10', 'created'), event('11', 'updated'), event('12', 'deleted')]))
      .toEqual([event('12', 'deleted')])
  })

  it('keeps coalesced entities in ascending cursor order after an interleaved replacement', () => {
    const event = (cursor: string, entityId: string): SyncEvent => ({
      cursor,
      domain: 'devices',
      entityType: 'Device',
      entityId,
      operation: 'updated',
      mutationKind: 'device.updated',
      entityVersion: '2026-07-12T00:00:00.000Z',
      affectedDomains: ['devices'],
    })
    expect(coalesceSyncEvents([
      event('10', 'device-a'),
      event('11', 'device-b'),
      event('12', 'device-a'),
    ])).toEqual([event('11', 'device-b'), event('12', 'device-a')])
  })

  it('detects retention gaps only against the authorized scoped stream', () => {
    expect(scopedCursorResetRequired(BigInt(0), BigInt(900))).toBe(false)
    expect(scopedCursorResetRequired(BigInt(500), BigInt(500))).toBe(false)
    expect(scopedCursorResetRequired(BigInt(500), BigInt(900))).toBe(true)
    expect(scopedCursorResetRequired(BigInt(500), null)).toBe(false)
  })
})
