/**
 * Centralized Telegram message templates for Oryx ERP.
 *
 * Rules (enforced by tests):
 *   - Pure functions, typed input, NO DB queries here.
 *   - Plain text only — NO Markdown asterisks (sendTelegramMessage sends without
 *     parse_mode, so `*bold*` would render literally).
 *   - Consistent Uzbek wording + money/date formatting.
 *   - Optional lines are omitted cleanly (never "undefined"/"null").
 *   - Never include raw DB IDs, passport URLs, tokens, secrets, or logins.
 */

import { uzDate } from '@/lib/dates'
import { telegramImei } from '@/lib/device-display'

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/** "8 500 000 so'm" (ru-RU groups with spaces). */
export function formatMoney(value: number | string | null | undefined): string {
  const n = Number(value ?? 0)
  return `${(Number.isFinite(n) ? n : 0).toLocaleString('ru-RU')} so'm`
}

/** "30.09.2026" — locale-independent numeric date. */
export function formatUzDate(value: Date | string | number | null | undefined): string {
  return uzDate(value)
}

/** Uzbek label for a payment/refund method, or null for unknown/empty. */
export function formatPaymentMethod(value?: string | null): string | null {
  switch (value) {
    case 'CASH':
      return 'Naqd'
    case 'TRANSFER':
      return "O'tkazma"
    case 'CARD':
      return 'Karta'
    case 'OTHER':
      return 'Boshqa'
    default:
      return null
  }
}

/** Trim a free-text note and collapse newlines so it never breaks the layout. */
export function cleanNote(value?: string | null): string | null {
  if (!value) return null
  const cleaned = value.replace(/\s*\n\s*/g, ' ').trim()
  return cleaned.length > 0 ? cleaned : null
}

/** `${label}: ${value}` when value is present, otherwise null (omitted). */
export function optionalLine(label: string, value?: string | number | null): string | null {
  if (value === null || value === undefined) return null
  const str = String(value).trim()
  return str.length > 0 ? `${label}: ${str}` : null
}

export interface DeviceSpecs {
  deviceModel: string
  storage?: string | null
  color?: string | null
  batteryHealth?: number | null
  imei?: string | null
}

/**
 * Device spec lines. Optional lines are omitted when empty. `battery: false`
 * drops the Batareya line (payment/reminder messages don't show it).
 */
export function formatDeviceSpecs(device: DeviceSpecs, opts: { battery?: boolean } = {}): string[] {
  const includeBattery = opts.battery ?? true
  return [
    optionalLine('Qurilma', device.deviceModel),
    optionalLine('Xotira', device.storage),
    optionalLine('Rang', device.color),
    includeBattery && typeof device.batteryHealth === 'number'
      ? `Batareya: ${device.batteryHealth}%`
      : null,
    optionalLine('IMEI', telegramImei(device.imei)),
  ].filter((line): line is string => line !== null)
}

// ---------------------------------------------------------------------------
// Composition helpers
// ---------------------------------------------------------------------------

type Line = string | null | undefined | false

/** Join non-empty lines within one block. */
function block(...lines: Line[]): string {
  return lines.filter((l): l is string => typeof l === 'string' && l.length > 0).join('\n')
}

/** Join non-empty blocks with a blank line between them. */
function compose(...blocks: Array<string | string[] | null | undefined>): string {
  return blocks
    .map((b) => (Array.isArray(b) ? block(...b) : b))
    .filter((b): b is string => typeof b === 'string' && b.length > 0)
    .join('\n\n')
}

/** Remaining-debt line value: "Yo'q" / "To'liq yopildi" when cleared. */
function remainingDebt(remaining: number, clearedLabel: "Yo'q" | "To'liq yopildi"): string {
  return remaining <= 0 ? clearedLabel : formatMoney(remaining)
}

// ---------------------------------------------------------------------------
// Bot direct replies
// ---------------------------------------------------------------------------

export function startSuperAdminMessage(adminName: string): string {
  return compose(
    `👋 Assalomu alaykum, ${adminName}`,
    'Siz Oryx ERP super admin sifatida ulandingiz.',
    'Endi platformadagi muhim bildirishnomalar shu bot orqali keladi.',
  )
}

export function startShopAdminMessage(adminName: string, shopName: string): string {
  return compose(
    `👋 Assalomu alaykum, ${adminName}`,
    `Siz ${shopName} do'koni uchun Oryx ERP bildirishnomalariga ulandingiz.`,
    "Endi sotuv, nasiya, to'lov va eslatmalar shu yerga keladi.",
  )
}

export function startUnknownMessage(telegramId: string): string {
  return compose(
    '⚠️ Telegram akkauntingiz Oryx ERP hisobiga ulanmagan.',
    "Iltimos, admin panelda Telegram ID'ingiz to'g'ri kiritilganini tekshiring.",
    `Sizning Telegram ID: ${telegramId}`,
  )
}

export function unknownCommandMessage(): string {
  return compose('❓ Bu buyruq mavjud emas.', 'Botdan foydalanish uchun /start yuboring.')
}

// ---------------------------------------------------------------------------
// Device messages
// ---------------------------------------------------------------------------

export function deviceAddedMessage(data: {
  shopName: string
  device: DeviceSpecs
  purchasePrice: number
  supplierPhone?: string | null
  adminName?: string | null
}): string {
  return compose(
    "📦 Yangi qurilma qo'shildi",
    optionalLine("Do'kon", data.shopName),
    formatDeviceSpecs(data.device),
    block(`Kelish narxi: ${formatMoney(data.purchasePrice)}`, optionalLine('Yetkazib beruvchi', data.supplierPhone)),
    optionalLine('Admin', data.adminName),
  )
}

export function deviceSoldMessage(data: {
  shopName: string
  device: DeviceSpecs
  customerName: string
  customerPhone?: string | null
  salePrice: number
  paidAmount: number
  remaining: number
  paymentMethod?: string | null
  adminName?: string | null
}): string {
  return compose(
    '✅ Qurilma sotildi',
    optionalLine("Do'kon", data.shopName),
    formatDeviceSpecs(data.device),
    block(optionalLine('Mijoz', data.customerName), optionalLine('Tel', data.customerPhone)),
    block(
      `Sotuv narxi: ${formatMoney(data.salePrice)}`,
      `To'langan: ${formatMoney(data.paidAmount)}`,
      `Qolgan qarz: ${remainingDebt(data.remaining, "Yo'q")}`,
      optionalLine("To'lov usuli", formatPaymentMethod(data.paymentMethod)),
    ),
    optionalLine('Admin', data.adminName),
  )
}

export function deviceReturnedMessage(data: {
  shopName: string
  device: DeviceSpecs
  refundAmount: number
  refundMethod?: string | null
  note: string
  adminName?: string | null
}): string {
  const showMethod = data.refundAmount > 0 || Boolean(formatPaymentMethod(data.refundMethod))
  return compose(
    '↩️ Qurilma qaytarildi',
    optionalLine("Do'kon", data.shopName),
    formatDeviceSpecs(data.device),
    block(
      `Qaytarilgan summa: ${formatMoney(data.refundAmount)}`,
      showMethod ? optionalLine('Qaytarish usuli', formatPaymentMethod(data.refundMethod)) : null,
    ),
    block(optionalLine('Sabab', cleanNote(data.note)), optionalLine('Admin', data.adminName)),
  )
}

export function deviceRestockedMessage(data: {
  shopName: string
  device: DeviceSpecs
  note: string
  adminName?: string | null
}): string {
  return compose(
    '🔄 Qurilma qayta sotuvga chiqarildi',
    optionalLine("Do'kon", data.shopName),
    formatDeviceSpecs(data.device),
    block(optionalLine('Sabab', cleanNote(data.note)), optionalLine('Admin', data.adminName)),
  )
}

// ---------------------------------------------------------------------------
// Nasiya messages
// ---------------------------------------------------------------------------

export function nasiyaCreatedMessage(data: {
  shopName: string
  customerName: string
  customerPhone?: string | null
  device: DeviceSpecs
  totalAmount: number
  downPayment: number
  baseRemainingAmount: number
  interestPercent: number
  interestAmount: number
  finalNasiyaAmount: number
  months: number
  monthlyPayment: number
  nextPaymentDate?: Date | string | null
  adminName?: string | null
}): string {
  const hasInterest = data.interestPercent > 0
  const moneyBlock = hasInterest
    ? block(
        `Narx: ${formatMoney(data.totalAmount)}`,
        `Boshlang'ich to'lov: ${formatMoney(data.downPayment)}`,
        `Qolgan summa: ${formatMoney(data.baseRemainingAmount)}`,
      )
    : block(
        `Narx: ${formatMoney(data.totalAmount)}`,
        `Boshlang'ich to'lov: ${formatMoney(data.downPayment)}`,
        `Nasiya jami: ${formatMoney(data.finalNasiyaAmount)}`,
      )
  const interestBlock = hasInterest
    ? block(
        `Nasiya foizi: ${data.interestPercent}%`,
        `Foiz summasi: ${formatMoney(data.interestAmount)}`,
        `Nasiya jami: ${formatMoney(data.finalNasiyaAmount)}`,
      )
    : null
  return compose(
    '📝 Yangi nasiya yaratildi',
    optionalLine("Do'kon", data.shopName),
    block(optionalLine('Mijoz', data.customerName), optionalLine('Tel', data.customerPhone)),
    formatDeviceSpecs(data.device),
    moneyBlock,
    interestBlock,
    block(
      `Muddat: ${data.months} oy`,
      `Oylik to'lov: ${formatMoney(data.monthlyPayment)}`,
      data.nextPaymentDate ? `Keyingi to'lov: ${formatUzDate(data.nextPaymentDate)}` : null,
    ),
    optionalLine('Admin', data.adminName),
  )
}

export function nasiyaPaymentMessage(data: {
  shopName: string
  customerName: string
  customerPhone?: string | null
  device: DeviceSpecs
  month?: number | 'MULTIPLE' | null
  paidAmount: number
  paymentMethod?: string | null
  remaining: number
  note?: string | null
  adminName?: string | null
}): string {
  const monthLine =
    data.month === 'MULTIPLE'
      ? 'Oy: Bir nechta oy'
      : typeof data.month === 'number'
        ? `Oy: ${data.month}-oy`
        : null
  return compose(
    "💰 Nasiya to'lovi qabul qilindi",
    optionalLine("Do'kon", data.shopName),
    block(optionalLine('Mijoz', data.customerName), optionalLine('Tel', data.customerPhone)),
    formatDeviceSpecs(data.device, { battery: false }),
    block(
      monthLine,
      `To'langan: ${formatMoney(data.paidAmount)}`,
      optionalLine("To'lov usuli", formatPaymentMethod(data.paymentMethod)),
      `Qolgan qarz: ${remainingDebt(data.remaining, "To'liq yopildi")}`,
    ),
    block(optionalLine('Izoh', cleanNote(data.note)), optionalLine('Admin', data.adminName)),
  )
}

export function nasiyaDueTodayMessage(data: {
  customerName: string
  customerPhone?: string | null
  device: DeviceSpecs
  month?: number | null
  amountDue: number
  dueDate: Date | string
}): string {
  return compose(
    "⏰ Bugun nasiya to'lovi kuni",
    block(optionalLine('Mijoz', data.customerName), optionalLine('Tel', data.customerPhone)),
    formatDeviceSpecs(data.device, { battery: false }),
    block(
      typeof data.month === 'number' ? `Oy: ${data.month}-oy` : null,
      `To'lov summasi: ${formatMoney(data.amountDue)}`,
      `Muddat: ${formatUzDate(data.dueDate)}`,
    ),
  )
}

export function nasiyaOverdueMessage(data: {
  customerName: string
  customerPhone?: string | null
  device: DeviceSpecs
  month?: number | null
  amountDue: number
  dueDate: Date | string
  daysLate: number
}): string {
  return compose(
    "⚠️ Nasiya to'lovi muddati o'tgan",
    block(optionalLine('Mijoz', data.customerName), optionalLine('Tel', data.customerPhone)),
    formatDeviceSpecs(data.device, { battery: false }),
    block(
      typeof data.month === 'number' ? `Oy: ${data.month}-oy` : null,
      `Qolgan to'lov: ${formatMoney(data.amountDue)}`,
      `Muddat: ${formatUzDate(data.dueDate)}`,
      `Kechikkan: ${data.daysLate} kun`,
    ),
  )
}

/**
 * Imported (pre-Oryx) nasiya. Deliberately titled "Eski nasiya import qilindi"
 * (NOT "Yangi nasiya") and shows the original/already-paid amounts as context so
 * no admin mistakes it for a new sale. Old amounts are informational only.
 */
export function nasiyaImportedMessage(data: {
  shopName: string
  customerName: string
  customerPhone?: string | null
  device: DeviceSpecs
  originalTotalAmount: number
  alreadyPaidBeforeImport: number
  remainingDebt: number
  monthlyPayment: number
  nextPaymentDate: Date | string
  adminName?: string | null
}): string {
  return compose(
    '📥 Eski nasiya import qilindi',
    optionalLine("Do'kon", data.shopName),
    block(optionalLine('Mijoz', data.customerName), optionalLine('Tel', data.customerPhone)),
    formatDeviceSpecs(data.device, { battery: false }),
    block(
      `Eski nasiya summasi: ${formatMoney(data.originalTotalAmount)}`,
      `Importgacha to'langan: ${formatMoney(data.alreadyPaidBeforeImport)}`,
      `Hozirgi qolgan qarz: ${formatMoney(data.remainingDebt)}`,
    ),
    block(
      `Oylik to'lov: ${formatMoney(data.monthlyPayment)}`,
      `Keyingi to'lov: ${formatUzDate(data.nextPaymentDate)}`,
    ),
    optionalLine('Admin', data.adminName),
  )
}

// ---------------------------------------------------------------------------
// Normal sale debt messages
// ---------------------------------------------------------------------------

export function salePaymentMessage(data: {
  shopName: string
  customerName: string
  customerPhone?: string | null
  device: DeviceSpecs
  paidAmount: number
  paymentMethod?: string | null
  remaining: number
  note?: string | null
  adminName?: string | null
}): string {
  return compose(
    "💰 Qarz to'lovi qabul qilindi",
    optionalLine("Do'kon", data.shopName),
    block(optionalLine('Mijoz', data.customerName), optionalLine('Tel', data.customerPhone)),
    formatDeviceSpecs(data.device, { battery: false }),
    block(
      `To'langan: ${formatMoney(data.paidAmount)}`,
      optionalLine("To'lov usuli", formatPaymentMethod(data.paymentMethod)),
      `Qolgan qarz: ${remainingDebt(data.remaining, "To'liq yopildi")}`,
    ),
    block(optionalLine('Izoh', cleanNote(data.note)), optionalLine('Admin', data.adminName)),
  )
}

export function saleDueTodayMessage(data: {
  customerName: string
  customerPhone?: string | null
  device: DeviceSpecs
  remainingAmount: number
  dueDate: Date | string
}): string {
  return compose(
    "⏰ Bugun qarz to'lovi kuni",
    block(optionalLine('Mijoz', data.customerName), optionalLine('Tel', data.customerPhone)),
    formatDeviceSpecs(data.device, { battery: false }),
    block(`To'lov summasi: ${formatMoney(data.remainingAmount)}`, `Muddat: ${formatUzDate(data.dueDate)}`),
  )
}

export function saleOverdueMessage(data: {
  customerName: string
  customerPhone?: string | null
  device: DeviceSpecs
  remainingAmount: number
  dueDate: Date | string
  daysLate: number
}): string {
  return compose(
    "⚠️ Qarz to'lovi muddati o'tgan",
    block(optionalLine('Mijoz', data.customerName), optionalLine('Tel', data.customerPhone)),
    formatDeviceSpecs(data.device, { battery: false }),
    block(
      `Qolgan qarz: ${formatMoney(data.remainingAmount)}`,
      `Muddat: ${formatUzDate(data.dueDate)}`,
      `Kechikkan: ${data.daysLate} kun`,
    ),
  )
}
