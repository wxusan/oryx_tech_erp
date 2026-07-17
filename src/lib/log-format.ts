import { displayImei } from '@/lib/device-display'
import { formatMoneyByCurrency, type CurrencyContext } from '@/lib/currency'
import {
  actorTypeLabel,
  deviceStatusLabel,
  logActionLabel,
  logTargetLabel,
  nasiyaStatusLabel,
  paymentMethodLabel,
  scheduleStatusLabel,
  shopStatusLabel,
} from '@/lib/presentation-labels'

const statusLabels: Record<string, string> = {
  ACTIVE: nasiyaStatusLabel('ACTIVE'),
  SUSPENDED: shopStatusLabel('SUSPENDED'),
  DELETED: deviceStatusLabel('DELETED'),
  IN_STOCK: deviceStatusLabel('IN_STOCK'),
  SOLD_CASH: deviceStatusLabel('SOLD_CASH'),
  SOLD_DEBT: deviceStatusLabel('SOLD_DEBT'),
  SOLD_NASIYA: deviceStatusLabel('SOLD_NASIYA'),
  RETURNED: deviceStatusLabel('RETURNED'),
  COMPLETED: nasiyaStatusLabel('COMPLETED'),
  OVERDUE: scheduleStatusLabel('OVERDUE'),
  CANCELLED: scheduleStatusLabel('CANCELLED'),
  PENDING: scheduleStatusLabel('PENDING'),
  PAID: scheduleStatusLabel('PAID'),
  PARTIAL: scheduleStatusLabel('PARTIAL'),
  DEFERRED: scheduleStatusLabel('DEFERRED'),
}

export function actorLabel(actorType: string) {
  return actorTypeLabel(actorType)
}

export function targetTypeLabel(targetType: string) {
  return logTargetLabel(targetType)
}

export function actionLabel(action: string, targetType: string) {
  return logActionLabel(action, targetType)
}

export function formatLogValue(value: unknown, currency?: CurrencyContext) {
  if (!value || typeof value !== 'object') return ''
  const data = value as Record<string, unknown>
  const parts = [
    stringPart(data.model),
    imeiPart(data.imei),
    stringPart(data.customerName),
    stringPart(data.name),
    stringPart(data.ownerName),
    typeof data.shopNumber === 'string' ? `#${data.shopNumber}` : undefined,
    moneyPart(data.amount, currency),
    moneyPart(data.totalAmount, currency),
    moneyPart(data.baseRemainingAmount, currency),
    typeof data.interestPercent === 'number' ? `Nasiya foizi: ${data.interestPercent}%` : undefined,
    moneyPart(data.interestAmount, currency),
    moneyPart(data.finalNasiyaAmount, currency),
    moneyPart(data.salePrice, currency),
    moneyPart(data.purchasePrice, currency),
    moneyPart(data.downPayment, currency),
    typeof data.months === 'number' ? `${data.months} oy` : undefined,
    typeof data.paymentMethod === 'string' ? paymentMethodLabel(data.paymentMethod) : undefined,
    typeof data.status === 'string' ? (statusLabels[data.status] ?? 'Holat noma’lum') : undefined,
    typeof data.reminderEnabled === 'boolean' ? `Eslatma: ${data.reminderEnabled ? 'yoqilgan' : 'o‘chirilgan'}` : undefined,
    typeof data.telegramId === 'string' ? `Telegram ID: ${data.telegramId || 'o‘chirilgan'}` : undefined,
    data.passwordChanged === true ? 'Parol o‘zgartirildi' : undefined,
    data.passwordReset === true ? 'Parol qayta o‘rnatildi' : undefined,
  ]

  return parts.filter(Boolean).join(' - ')
}

export function targetLabel(targetType: string, targetId: string, value: unknown) {
  const data = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const label = targetTypeLabel(targetType)
  const name =
    stringPart(data.model) ??
    stringPart(data.customerName) ??
    stringPart(data.name) ??
    imeiPart(data.imei)

  return name ? `${label}: ${name}` : `${label}: ${targetId.slice(0, 8)}`
}

function stringPart(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function imeiPart(value: unknown) {
  return typeof value === 'string' && value.trim() ? displayImei(value) : undefined
}

function moneyPart(value: unknown, currency?: CurrencyContext) {
  if (typeof value !== 'number') return undefined
  if (!currency) return `${value.toLocaleString('ru-RU')} so‘m`
  return formatMoneyByCurrency(value, currency.currency, currency.usdUzsRate)
}
