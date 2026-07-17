import {
  DEVICE_STATUS_LABELS,
  deviceStatusLabel as approvedDeviceStatusLabel,
  logActionLabel,
} from '@/lib/presentation-labels'

export function isImportPlaceholderImei(imei?: string | null): boolean {
  return typeof imei === 'string' && imei.trim().startsWith('IMPORT-')
}

/** Olib-sotdim devices without a real IMEI get a "NOIMEI-<id>" placeholder — same idea as IMPORT-, also hidden everywhere. */
export function isNoImeiPlaceholder(imei?: string | null): boolean {
  return typeof imei === 'string' && imei.trim().startsWith('NOIMEI-')
}

export function isPlaceholderImei(imei?: string | null): boolean {
  return isImportPlaceholderImei(imei) || isNoImeiPlaceholder(imei)
}

export function displayImei(imei?: string | null): string {
  const trimmed = imei?.trim()
  if (!trimmed || isPlaceholderImei(trimmed)) return 'Kiritilmagan'
  return trimmed
}

export function telegramImei(imei?: string | null): string | null {
  const trimmed = imei?.trim()
  if (!trimmed || isPlaceholderImei(trimmed)) return null
  return trimmed
}

/**
 * Whether a device matches the free-text search box on the sale/nasiya device
 * pickers (by model, color, or IMEI). Empty query matches everything. Shared so
 * both pickers behave identically.
 */
export function deviceMatchesSearch(
  device: { model: string; color?: string | null; imei: string },
  query: string,
): boolean {
  const q = query.toLowerCase()
  if (!q) return true
  return (
    device.model.toLowerCase().includes(q) ||
    (device.color ?? '').toLowerCase().includes(q) ||
    device.imei.toLowerCase().includes(q)
  )
}

export { DEVICE_STATUS_LABELS }

/** Uzbek label for a device status without exposing unknown internal values. */
export function deviceStatusLabel(status: string): string {
  return approvedDeviceStatusLabel(status)
}

/** Item 3 — extracted from the device detail page (was an inline function). Uzbek label for a device history log action. */
export function deviceActionLabel(action: string): string {
  return logActionLabel(action, 'Device')
}
