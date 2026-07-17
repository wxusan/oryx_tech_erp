import type { DeviceStatus, NasiyaStatus, PaymentMethod } from '@/lib/domain-types'
import {
  DEVICE_STATUS_LABELS,
  NASIYA_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  SCHEDULE_STATUS_LABELS,
  deviceStatusLabel as approvedDeviceStatusLabel,
  historyStatusLabel,
  nasiyaStatusLabel as approvedNasiyaStatusLabel,
  paymentMethodLabel as approvedPaymentMethodLabel,
  scheduleStatusLabel as approvedScheduleStatusLabel,
} from '@/lib/presentation-labels'

export const paymentMethodLabels: Record<PaymentMethod, string> = PAYMENT_METHOD_LABELS
export const deviceStatusLabels: Record<DeviceStatus, string> = DEVICE_STATUS_LABELS
export const nasiyaStatusLabels: Record<NasiyaStatus, string> = NASIYA_STATUS_LABELS
export const scheduleStatusLabels: Record<string, string> = SCHEDULE_STATUS_LABELS

export function paymentMethodLabel(value?: string | null) {
  return value ? approvedPaymentMethodLabel(value) : '-'
}

export function deviceStatusLabel(value?: string | null) {
  return value ? approvedDeviceStatusLabel(value) : '-'
}

export function nasiyaStatusLabel(value?: string | null) {
  return value ? approvedNasiyaStatusLabel(value) : '-'
}

export function scheduleStatusLabel(value?: string | null) {
  return value ? approvedScheduleStatusLabel(value) : '-'
}

export { historyStatusLabel }
