import type { DeviceStatus, NasiyaStatus, PaymentMethod } from '@/lib/domain-types'

export const paymentMethodLabels: Record<PaymentMethod, string> = {
  CASH: 'Naqd',
  TRANSFER: "Bank o'tkazmasi",
  CARD: 'Karta',
  OTHER: 'Boshqa',
}

export const deviceStatusLabels: Record<DeviceStatus, string> = {
  IN_STOCK: 'Omborda',
  SOLD_CASH: 'Naqd sotildi',
  SOLD_DEBT: 'Qarzga sotilgan',
  SOLD_NASIYA: 'Nasiyaga sotildi',
  RETURNED: 'Qaytarilgan (eski holat)',
  DELETED: "O'chirilgan",
}

export const nasiyaStatusLabels: Record<NasiyaStatus, string> = {
  ACTIVE: 'Faol',
  COMPLETED: 'Yopilgan',
  OVERDUE: "Muddati o'tgan",
  CANCELLED: 'Bekor qilingan',
}

export const scheduleStatusLabels: Record<string, string> = {
  PENDING: 'Kutilmoqda',
  PAID: "To'langan",
  PARTIAL: 'Qisman',
  OVERDUE: "Muddati o'tgan",
  DEFERRED: 'Kechiktirilgan',
  CANCELLED: 'Bekor qilingan',
}

export function paymentMethodLabel(value?: string | null) {
  if (!value) return '-'
  return (paymentMethodLabels as Record<string, string>)[value] ?? value
}

export function deviceStatusLabel(value?: string | null) {
  if (!value) return '-'
  return (deviceStatusLabels as Record<string, string>)[value] ?? value
}

export function nasiyaStatusLabel(value?: string | null) {
  if (!value) return '-'
  return (nasiyaStatusLabels as Record<string, string>)[value] ?? value
}

export function scheduleStatusLabel(value?: string | null) {
  if (!value) return '-'
  return scheduleStatusLabels[value] ?? value
}
