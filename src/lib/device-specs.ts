export type DeviceStorageUnit = 'GB' | 'TB'
export type DeviceConditionCode = 'NEW' | 'USED'

export const DEVICE_CONDITION_LABELS: Record<DeviceConditionCode, 'Yangi' | 'B/U'> = {
  NEW: 'Yangi',
  USED: 'B/U',
}

export function parseDeviceStorage(input: string | null | undefined, defaultUnit?: DeviceStorageUnit) {
  const raw = input?.trim().toUpperCase() ?? ''
  const match = raw.match(/^([0-9]+(?:\.[0-9]{1,2})?)\s*(GB|TB)?$/)
  if (!match) return null
  const amount = Number(match[1])
  const unit = (match[2] as DeviceStorageUnit | undefined) ?? defaultUnit
  if (!unit || !Number.isFinite(amount) || amount <= 0) return null
  return { amount, unit, display: `${Number.isInteger(amount) ? amount : amount.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}${unit}` }
}

export function formatDeviceStorage(input: {
  storageAmount?: unknown
  storageUnit?: DeviceStorageUnit | null
  storage?: string | null
}): string {
  if (input.storageAmount != null && input.storageUnit) {
    const amount = Number(input.storageAmount)
    if (Number.isFinite(amount) && amount > 0) return `${Number.isInteger(amount) ? amount : amount.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}${input.storageUnit}`
  }
  return input.storage?.trim() ?? ''
}

export function deviceConditionLabel(code: DeviceConditionCode | null | undefined): string {
  return code ? DEVICE_CONDITION_LABELS[code] : 'Belgilanmagan'
}

export function normalizeImei(input: string): string | null {
  const normalized = input.replace(/[\s-]/g, '')
  return /^\d{15}$/.test(normalized) ? normalized : null
}

export function isValidImei(input: string): boolean {
  return normalizeImei(input) !== null
}

export function validateImeiPair(primary: string, secondary?: string | null) {
  const primaryImei = normalizeImei(primary)
  if (!primaryImei) return { ok: false as const, message: 'Asosiy IMEI 15 ta raqamdan iborat bo\'lishi kerak' }
  const secondaryImei = secondary?.trim() ? normalizeImei(secondary) : null
  if (secondary?.trim() && !secondaryImei) return { ok: false as const, message: 'Ikkinchi IMEI 15 ta raqamdan iborat bo\'lishi kerak' }
  if (secondaryImei === primaryImei) return { ok: false as const, message: 'Asosiy va ikkinchi IMEI bir xil bo\'lishi mumkin emas' }
  return { ok: true as const, primaryImei, secondaryImei }
}
