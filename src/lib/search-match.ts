/**
 * Shared "advanced search" predicates for the shop's client-side filtered
 * lists (qurilmalar, nasiyalar). Pure functions so they're unit-testable
 * without rendering React; both the client component and its tests import
 * from here.
 *
 * Phone matching handles spaces/plus signs by also comparing normalized
 * (digits-only) forms, so "90 123 45 67" matches "+998901234567".
 */

import { normalizePhone } from '@/lib/phone'

function norm(value: string | null | undefined): string {
  return (value ?? '').toLowerCase()
}

export interface DeviceSearchable {
  model: string
  imei: string
  color?: string | null
  storage?: string | null
  batteryHealth?: number | null
  note?: string | null
  supplierName?: string | null
  supplierPhone?: string | null
}

export function matchesDeviceSearch(device: DeviceSearchable, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const qDigits = normalizePhone(query) ?? ''

  return (
    norm(device.model).includes(q) ||
    device.imei.toLowerCase().includes(q) ||
    norm(device.color).includes(q) ||
    norm(device.storage).includes(q) ||
    norm(device.note).includes(q) ||
    norm(device.supplierName).includes(q) ||
    norm(device.supplierPhone).includes(q) ||
    (qDigits.length > 0 && (normalizePhone(device.supplierPhone ?? '') ?? '').includes(qDigits))
  )
}

export interface NasiyaSearchable {
  customerName: string
  customerPhone: string
  deviceModel: string
  imei: string
  note?: string | null
  statusLabel?: string | null
}

export function matchesNasiyaSearch(nasiya: NasiyaSearchable, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const qDigits = normalizePhone(query) ?? ''
  const customerPhoneDigits = normalizePhone(nasiya.customerPhone) ?? ''

  return (
    norm(nasiya.customerName).includes(q) ||
    norm(nasiya.customerPhone).includes(q) ||
    (qDigits.length > 0 && customerPhoneDigits.includes(qDigits)) ||
    norm(nasiya.deviceModel).includes(q) ||
    nasiya.imei.toLowerCase().includes(q) ||
    norm(nasiya.note).includes(q) ||
    norm(nasiya.statusLabel).includes(q)
  )
}
