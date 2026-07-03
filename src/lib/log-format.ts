import { displayImei } from '@/lib/device-display'

const actionLabels: Record<string, string> = {
  CREATE: "Qo'shildi",
  CREATE_NASIYA: 'Nasiya yaratildi',
  IMPORT_NASIYA: 'Eski nasiya import qilindi',
  PAYMENT: "To'lov qabul qilindi",
  SELL: 'Sotuv qilindi',
  RETURN: 'Qaytarildi',
  RESTOCK: 'Omborga qaytarildi',
  UPDATE: "Ma'lumot yangilandi",
  DELETE: "O'chirildi",
  IMPORT: 'Import qilindi',
  RESET_PASSWORD: 'Parol tiklandi',
  CHANGE_PASSWORD: 'Parol yangilandi',
  UPDATE_TELEGRAM_ID: 'Telegram ID yangilandi',
  UPDATE_REMINDER: 'Eslatma sozlamasi yangilandi',
  PAY_SUBSCRIPTION: "Obuna to'lovi qabul qilindi",
  PROVISION_LOGIN_CREDENTIALS: 'Kirish maʼlumotlari sozlandi',
  SEED_DEMO: "Demo ma'lumotlar qo'shildi",
}

const targetLabels: Record<string, string> = {
  Database: "Ma'lumotlar bazasi",
  Device: 'Qurilma',
  Customer: 'Mijoz',
  Nasiya: 'Nasiya',
  NasiyaSchedule: "Nasiya to'lovi",
  Sale: 'Sotuv',
  Shop: "Do'kon",
  ShopAdmin: "Do'kon admini",
  SuperAdmin: 'Bosh admin',
}

const paymentMethodLabels: Record<string, string> = {
  CASH: 'Naqd',
  TRANSFER: "Pul o'tkazma",
  CARD: 'Karta',
  OTHER: 'Boshqa',
}

const statusLabels: Record<string, string> = {
  ACTIVE: 'Faol',
  SUSPENDED: "To'xtatilgan",
  DELETED: "O'chirilgan",
  IN_STOCK: 'Omborda',
  SOLD_CASH: 'Naqd sotilgan',
  SOLD_NASIYA: 'Nasiyaga sotilgan',
  RESERVED: 'Band qilingan',
  RETURNED: 'Qaytarilgan',
  COMPLETED: 'Yakunlangan',
  OVERDUE: "Muddati o'tgan",
  CANCELLED: 'Bekor qilingan',
  PENDING: 'Kutilmoqda',
  PAID: "To'langan",
  PARTIAL: 'Qisman toʻlangan',
  DEFERRED: 'Kechiktirilgan',
}

export function actorLabel(actorType: string) {
  if (actorType === 'SUPER_ADMIN') return 'Bosh admin'
  if (actorType === 'SHOP_ADMIN') return "Do'kon admini"
  return actorType
}

export function targetTypeLabel(targetType: string) {
  return targetLabels[targetType] ?? 'Yozuv'
}

export function actionLabel(action: string, targetType: string) {
  if (action === 'CREATE' && targetType === 'Shop') return "Do'kon yaratildi"
  if (action === 'CREATE' && targetType === 'ShopAdmin') return "Do'kon admini qo'shildi"
  if (action === 'CREATE' && targetType === 'Device') return "Qurilma qo'shildi"
  if (action === 'CREATE' && targetType === 'Customer') return "Mijoz qo'shildi"
  return actionLabels[action] ?? 'Boshqa amal'
}

export function formatLogValue(value: unknown) {
  if (!value || typeof value !== 'object') return ''
  const data = value as Record<string, unknown>
  const parts = [
    stringPart(data.model),
    imeiPart(data.imei),
    stringPart(data.customerName),
    stringPart(data.name),
    stringPart(data.ownerName),
    typeof data.shopNumber === 'string' ? `#${data.shopNumber}` : undefined,
    moneyPart(data.amount),
    moneyPart(data.totalAmount),
    moneyPart(data.baseRemainingAmount),
    typeof data.interestPercent === 'number' ? `Nasiya foizi: ${data.interestPercent}%` : undefined,
    moneyPart(data.interestAmount),
    moneyPart(data.finalNasiyaAmount),
    moneyPart(data.salePrice),
    moneyPart(data.purchasePrice),
    moneyPart(data.downPayment),
    typeof data.months === 'number' ? `${data.months} oy` : undefined,
    typeof data.paymentMethod === 'string' ? (paymentMethodLabels[data.paymentMethod] ?? "Noma'lum to'lov usuli") : undefined,
    typeof data.status === 'string' ? (statusLabels[data.status] ?? "Noma'lum holat") : undefined,
    typeof data.reminderEnabled === 'boolean' ? `Eslatma: ${data.reminderEnabled ? 'yoqilgan' : "o'chirilgan"}` : undefined,
    typeof data.telegramId === 'string' ? `Telegram ID: ${data.telegramId || "o'chirilgan"}` : undefined,
    data.passwordChanged === true ? 'Parol yangilandi' : undefined,
    data.passwordReset === true ? 'Parol tiklandi' : undefined,
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

function moneyPart(value: unknown) {
  if (typeof value !== 'number') return undefined
  return `${value.toLocaleString('ru-RU')} so'm`
}
