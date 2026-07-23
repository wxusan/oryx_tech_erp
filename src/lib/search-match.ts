/**
 * Shared "advanced search" predicates for the shop's client-side filtered
 * lists (qurilmalar, nasiyalar). Pure functions so they're unit-testable
 * without rendering React; both the client component and its tests import
 * from here.
 *
 * Identifier matching compares one digits-only contiguous needle when, and
 * only when, the whole query is identifier-like. Mixed model text such as
 * "iPhone 13" therefore never falls back to an unrelated phone containing 13.
 */

import { matchesSearchValue } from '@/lib/search-needle'

export interface DeviceSearchable {
  model: string
  imei: string
  imeis?: Array<{ value: string } | string> | null
  color?: string | null
  storage?: string | null
  batteryHealth?: number | null
  note?: string | null
  supplierName?: string | null
  supplierPhone?: string | null
  // The sold-to/nasiya customer's name, if this device has been sold —
  // lets "devices" search find e.g. "which device did Aziz buy". See item 14.
  customerName?: string | null
  customerPhone?: string | null
  additionalPhones?: string[] | null
}

export function matchesDeviceSearch(device: DeviceSearchable, query: string): boolean {
  if (!query.trim()) return true
  const imeis = (device.imeis ?? []).map((entry) => typeof entry === 'string' ? entry : entry.value)

  return [
    [device.model, 'text'],
    [device.imei, 'identifier'],
    ...imeis.map((value) => [value, 'identifier']),
    [device.color, 'text'],
    [device.storage, 'text'],
    [device.note, 'text'],
    [device.supplierName, 'text'],
    [device.supplierPhone, 'identifier'],
    [device.customerName, 'text'],
    [device.customerPhone, 'identifier'],
    ...(device.additionalPhones ?? []).map((value) => [value, 'identifier']),
  ].some(([value, mode]) => matchesSearchValue(
    value as string | null | undefined,
    query,
    mode as 'text' | 'identifier',
  ))
}

export interface NasiyaSearchable {
  customerName: string
  customerPhone: string
  additionalPhones?: string[] | null
  deviceModel: string
  imei: string
  imeis?: Array<{ value: string } | string> | null
  note?: string | null
  statusLabel?: string | null
}

export function matchesNasiyaSearch(nasiya: NasiyaSearchable, query: string): boolean {
  if (!query.trim()) return true
  const imeis = (nasiya.imeis ?? []).map((entry) => typeof entry === 'string' ? entry : entry.value)

  return [
    [nasiya.customerName, 'text'],
    [nasiya.customerPhone, 'identifier'],
    ...(nasiya.additionalPhones ?? []).map((value) => [value, 'identifier']),
    [nasiya.deviceModel, 'text'],
    [nasiya.imei, 'identifier'],
    ...imeis.map((value) => [value, 'identifier']),
    [nasiya.note, 'text'],
    [nasiya.statusLabel, 'text'],
  ].some(([value, mode]) => matchesSearchValue(
    value as string | null | undefined,
    query,
    mode as 'text' | 'identifier',
  ))
}
