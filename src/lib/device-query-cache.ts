'use client'

import type { QueryClient } from '@tanstack/react-query'
import type { DeviceListItem, DeviceListPage } from '@/lib/device-list-contract'
import { deviceListQueryFromKey, queryKeys, type DeviceListQuery } from '@/lib/query-keys'
import type { AuthenticatedQueryScope } from '@/lib/query-scope'
import { matchesSearchValue } from '@/lib/search-needle'

type SearchableCachedDevice = DeviceListItem & {
  imeis?: Array<{ value: string } | string> | null
  customerPhone?: string | null
  additionalPhones?: string[] | null
}

export function deviceMatchesListQuery(device: DeviceListItem, query: DeviceListQuery) {
  if (query.status !== 'Barchasi' && device.status !== query.status) return false
  if (query.condition && query.condition !== 'ALL' && device.conditionCode !== query.condition) return false
  const search = query.search.trim()
  if (!search) return true
  const searchable = device as SearchableCachedDevice
  const relatedImeis = (searchable.imeis ?? []).map((entry) => (
    typeof entry === 'string' ? entry : entry.value
  ))
  return [
    [device.model, 'text'],
    [device.imei, 'identifier'],
    [device.primaryImei, 'identifier'],
    [device.secondaryImei, 'identifier'],
    ...relatedImeis.map((value) => [value, 'identifier']),
    [device.color, 'text'],
    [device.storage, 'text'],
    [device.storageDisplay, 'text'],
    [device.conditionLabel, 'text'],
    [device.note, 'text'],
    [device.supplierName, 'text'],
    [device.supplierPhone, 'identifier'],
    [device.saleInfo?.customerName, 'text'],
    [searchable.customerPhone, 'identifier'],
    ...(searchable.additionalPhones ?? []).map((value) => [value, 'identifier']),
  ].some(([value, mode]) => matchesSearchValue(
    value as string | null | undefined,
    search,
    mode as 'text' | 'identifier',
  ))
}

function sortDevices(items: DeviceListItem[]) {
  return items.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function patchDeviceUpsert(
  queryClient: QueryClient,
  scope: AuthenticatedQueryScope,
  device: DeviceListItem,
) {
  const cached = queryClient.getQueriesData<DeviceListPage>({ queryKey: queryKeys.devices.lists(scope) })
  for (const [key, current] of cached) {
    if (!current) continue
    const query = deviceListQueryFromKey(key)
    if (!query) continue
    // A server search can match privacy-scoped fields that are intentionally
    // absent from the cached DTO (for example an additional customer phone).
    // Keep the visible rows stable and let the authoritative bounded query
    // decide membership instead of locally removing a valid result.
    if (query.search.trim()) {
      void queryClient.invalidateQueries({ queryKey: key, exact: true, refetchType: 'active' })
      continue
    }
    const index = current.items.findIndex((item) => item.id === device.id)
    const matches = deviceMatchesListQuery(device, query)
    let next = current
    let requiresBackgroundFill = false

    if (index >= 0 && matches) {
      if (current.items[index] !== device) {
        const items = current.items.slice()
        items[index] = device
        next = { ...current, items: sortDevices(items) }
      }
    } else if (index >= 0 && !matches) {
      next = { ...current, items: current.items.filter((item) => item.id !== device.id), total: Math.max(0, current.total - 1) }
      requiresBackgroundFill = true
    } else if (index < 0 && matches) {
      if (query.page === 1) {
        next = { ...current, items: sortDevices([device, ...current.items]).slice(0, query.take), total: current.total + 1 }
      } else {
        next = { ...current, total: current.total + 1 }
        requiresBackgroundFill = true
      }
    }

    if (next !== current) queryClient.setQueryData(key, next)
    if (requiresBackgroundFill) {
      void queryClient.invalidateQueries({ queryKey: key, exact: true, refetchType: 'active' })
    }
  }
}

export function patchDeviceDelete(
  queryClient: QueryClient,
  scope: AuthenticatedQueryScope,
  deviceId: string,
) {
  const cached = queryClient.getQueriesData<DeviceListPage>({ queryKey: queryKeys.devices.lists(scope) })
  for (const [key, current] of cached) {
    if (!current || !current.items.some((item) => item.id === deviceId)) continue
    queryClient.setQueryData<DeviceListPage>(key, {
      ...current,
      items: current.items.filter((item) => item.id !== deviceId),
      total: Math.max(0, current.total - 1),
    })
    void queryClient.invalidateQueries({ queryKey: key, exact: true, refetchType: 'active' })
  }
}
