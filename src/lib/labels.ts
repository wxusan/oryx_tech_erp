export const paymentMethodLabels: Record<string, string> = {
  CASH: 'Naqd',
  TRANSFER: "Bank o'tkazmasi",
  CARD: 'Karta',
  OTHER: 'Boshqa',
}

export const deviceStatusLabels: Record<string, string> = {
  IN_STOCK: 'Omborda',
  SOLD_CASH: 'Naqd sotildi',
  SOLD_NASIYA: 'Nasiyaga sotildi',
  RESERVED: 'Band qilingan',
  RETURNED: 'Qaytarilgan',
  DELETED: "O'chirilgan",
}

export const nasiyaStatusLabels: Record<string, string> = {
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
}

export function paymentMethodLabel(value?: string | null) {
  if (!value) return '-'
  return paymentMethodLabels[value] ?? value
}

export function deviceStatusLabel(value?: string | null) {
  if (!value) return '-'
  return deviceStatusLabels[value] ?? value
}

export function nasiyaStatusLabel(value?: string | null) {
  if (!value) return '-'
  return nasiyaStatusLabels[value] ?? value
}

export function scheduleStatusLabel(value?: string | null) {
  if (!value) return '-'
  return scheduleStatusLabels[value] ?? value
}
