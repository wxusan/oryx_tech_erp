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
import { formatMoneyWithBase, type CurrencyContext, type CurrencyCode } from '@/lib/currency'
import { formatContractMoneyWithDisplay } from '@/lib/nasiya-contract'

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/** "8 500 000 so'm" (ru-RU groups with spaces). */
export function formatMoney(value: number | string | null | undefined): string {
  const n = Number(value ?? 0)
  return `${(Number.isFinite(n) ? n : 0).toLocaleString('ru-RU')} so'm`
}

function telegramMoney(value: number | string | null | undefined, currency?: CurrencyContext | null): string {
  if (!currency) return formatMoney(value)
  return formatMoneyWithBase(value, currency.currency, currency.usdUzsRate)
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

/** Format a native (already-in-that-currency) amount — never converts, unlike telegramMoney/formatMoneyByCurrency. */
function formatNativeAmount(amount: number, currency: CurrencyCode): string {
  return currency === 'USD' ? `$${amount.toFixed(2)}` : formatMoney(amount)
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
  currency?: CurrencyContext | null
}): string {
  return compose(
    "📦 Yangi qurilma qo'shildi",
    optionalLine("Do'kon", data.shopName),
    formatDeviceSpecs(data.device),
    block(`Kelish narxi: ${telegramMoney(data.purchasePrice, data.currency)}`, optionalLine('Yetkazib beruvchi', data.supplierPhone)),
    optionalLine('Admin', data.adminName),
  )
}

export function deviceSoldMessage(data: {
  shopName: string
  device: DeviceSpecs
  customerName: string
  customerPhone?: string | null
  /** The sale's own contract-currency amounts — see docs/currency-accounting-model.md. */
  salePrice: number
  paidAmount: number
  remaining: number
  contractCurrency: CurrencyCode
  paymentMethod?: string | null
  adminName?: string | null
  currency?: CurrencyContext | null
}): string {
  const contractMoney = (amount: number) =>
    formatContractMoneyWithDisplay(amount, data.contractCurrency, data.currency?.currency ?? 'UZS', data.currency?.usdUzsRate)
  return compose(
    '✅ Qurilma sotildi',
    optionalLine("Do'kon", data.shopName),
    formatDeviceSpecs(data.device),
    block(optionalLine('Mijoz', data.customerName), optionalLine('Tel', data.customerPhone)),
    block(
      `Sotuv narxi: ${contractMoney(data.salePrice)}`,
      `To'langan: ${contractMoney(data.paidAmount)}`,
      `Qolgan qarz: ${data.remaining <= 0 ? "Yo'q" : contractMoney(data.remaining)}`,
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
  currency?: CurrencyContext | null
}): string {
  const showMethod = data.refundAmount > 0 || Boolean(formatPaymentMethod(data.refundMethod))
  return compose(
    '↩️ Qurilma qaytarildi',
    optionalLine("Do'kon", data.shopName),
    formatDeviceSpecs(data.device),
    block(
      `Qaytarilgan summa: ${telegramMoney(data.refundAmount, data.currency)}`,
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
  currency?: CurrencyContext | null
}): string {
  const hasInterest = data.interestPercent > 0
  const moneyBlock = hasInterest
    ? block(
        `Narx: ${telegramMoney(data.totalAmount, data.currency)}`,
        `Boshlang'ich to'lov: ${telegramMoney(data.downPayment, data.currency)}`,
        `Qolgan summa: ${telegramMoney(data.baseRemainingAmount, data.currency)}`,
      )
    : block(
        `Narx: ${telegramMoney(data.totalAmount, data.currency)}`,
        `Boshlang'ich to'lov: ${telegramMoney(data.downPayment, data.currency)}`,
        `Nasiya jami: ${telegramMoney(data.finalNasiyaAmount, data.currency)}`,
      )
  const interestBlock = hasInterest
    ? block(
        `Nasiya foizi: ${data.interestPercent}%`,
        `Foiz summasi: ${telegramMoney(data.interestAmount, data.currency)}`,
        `Nasiya jami: ${telegramMoney(data.finalNasiyaAmount, data.currency)}`,
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
      `Oylik to'lov: ${telegramMoney(data.monthlyPayment, data.currency)}`,
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
  /** Amount actually applied to the nasiya's own contract-currency debt — see docs/currency-accounting-model.md. */
  paidAmount: number
  /** Remaining contract-currency debt after this payment. */
  remaining: number
  contractCurrency: CurrencyCode
  paymentMethod?: string | null
  note?: string | null
  adminName?: string | null
  currency?: CurrencyContext | null
  /**
   * Per-schedule breakdown when one payment spans more than one month (an
   * overpayment prepaying the next installment). First entry is always the
   * selected/current month; any further entries are future months paid ahead
   * of their due date. Omitted (or single-entry) payments show no breakdown.
   * Amounts are in the nasiya's own contract currency.
   */
  allocations?: { monthNumber: number; amount: number }[]
  /**
   * What the customer actually entered, when it differs from the deal's own
   * contract currency — shows "To'langan: <native>" + "Shartnomaga
   * qo'llandi: <applied>" instead of one figure, so a USD payment applied to
   * a UZS contract (or vice versa) is unambiguous. Omit when payment
   * currency matches contract currency (nothing was converted).
   */
  paymentInput?: { amount: number; currency: CurrencyCode } | null
}): string {
  const monthLine =
    data.month === 'MULTIPLE'
      ? 'Oy: Bir nechta oy'
      : typeof data.month === 'number'
        ? `Oy: ${data.month}-oy`
        : null
  const displayCurrency = data.currency?.currency ?? 'UZS'
  const contractMoney = (amount: number) => formatContractMoneyWithDisplay(amount, data.contractCurrency, displayCurrency, data.currency?.usdUzsRate)
  const allocationBlock =
    data.allocations && data.allocations.length > 1
      ? data.allocations.map((allocation, index) =>
          index === 0
            ? `${contractMoney(allocation.amount)} joriy oy uchun yopildi`
            : `${contractMoney(allocation.amount)} ${allocation.monthNumber}-oyga oldindan qo'llandi`,
        )
      : null
  const paidLines =
    data.paymentInput && data.paymentInput.currency !== data.contractCurrency
      ? [
          `To'langan: ${formatNativeAmount(data.paymentInput.amount, data.paymentInput.currency)}`,
          `Shartnomaga qo'llandi: ${contractMoney(data.paidAmount)}`,
        ]
      : [`To'langan: ${contractMoney(data.paidAmount)}`]
  return compose(
    "💰 Nasiya to'lovi qabul qilindi",
    optionalLine("Do'kon", data.shopName),
    block(optionalLine('Mijoz', data.customerName), optionalLine('Tel', data.customerPhone)),
    formatDeviceSpecs(data.device, { battery: false }),
    block(
      monthLine,
      ...paidLines,
      optionalLine("To'lov usuli", formatPaymentMethod(data.paymentMethod)),
      `Qolgan qarz: ${data.remaining <= 0 ? "To'liq yopildi" : contractMoney(data.remaining)}`,
    ),
    allocationBlock,
    block(optionalLine('Izoh', cleanNote(data.note)), optionalLine('Admin', data.adminName)),
  )
}

export function nasiyaDueTodayMessage(data: {
  customerName: string
  customerPhone?: string | null
  device: DeviceSpecs
  month?: number | null
  /** The schedule's own contract-currency outstanding balance — see docs/currency-accounting-model.md. */
  amountDue: number
  contractCurrency: CurrencyCode
  dueDate: Date | string
  currency?: CurrencyContext | null
}): string {
  return compose(
    "⏰ Bugun nasiya to'lovi kuni",
    block(optionalLine('Mijoz', data.customerName), optionalLine('Tel', data.customerPhone)),
    formatDeviceSpecs(data.device, { battery: false }),
    block(
      typeof data.month === 'number' ? `Oy: ${data.month}-oy` : null,
      `To'lov summasi: ${formatContractMoneyWithDisplay(data.amountDue, data.contractCurrency, data.currency?.currency ?? 'UZS', data.currency?.usdUzsRate)}`,
      `Muddat: ${formatUzDate(data.dueDate)}`,
    ),
  )
}

export function nasiyaOverdueMessage(data: {
  customerName: string
  customerPhone?: string | null
  device: DeviceSpecs
  month?: number | null
  /** The schedule's own contract-currency outstanding balance — see docs/currency-accounting-model.md. */
  amountDue: number
  contractCurrency: CurrencyCode
  dueDate: Date | string
  daysLate: number
  currency?: CurrencyContext | null
}): string {
  return compose(
    "⚠️ Nasiya to'lovi muddati o'tgan",
    block(optionalLine('Mijoz', data.customerName), optionalLine('Tel', data.customerPhone)),
    formatDeviceSpecs(data.device, { battery: false }),
    block(
      typeof data.month === 'number' ? `Oy: ${data.month}-oy` : null,
      `Qolgan to'lov: ${formatContractMoneyWithDisplay(data.amountDue, data.contractCurrency, data.currency?.currency ?? 'UZS', data.currency?.usdUzsRate)}`,
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
  currency?: CurrencyContext | null
}): string {
  return compose(
    '📥 Eski nasiya import qilindi',
    optionalLine("Do'kon", data.shopName),
    block(optionalLine('Mijoz', data.customerName), optionalLine('Tel', data.customerPhone)),
    formatDeviceSpecs(data.device, { battery: false }),
    block(
      `Eski nasiya summasi: ${telegramMoney(data.originalTotalAmount, data.currency)}`,
      `Importgacha to'langan: ${telegramMoney(data.alreadyPaidBeforeImport, data.currency)}`,
      `Hozirgi qolgan qarz: ${telegramMoney(data.remainingDebt, data.currency)}`,
    ),
    block(
      `Oylik to'lov: ${telegramMoney(data.monthlyPayment, data.currency)}`,
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
  /** Amount actually applied to the sale's own contract-currency debt — see docs/currency-accounting-model.md. */
  paidAmount: number
  /** Remaining contract-currency debt after this payment. */
  remaining: number
  contractCurrency: CurrencyCode
  paymentMethod?: string | null
  note?: string | null
  adminName?: string | null
  currency?: CurrencyContext | null
  /**
   * What the customer actually entered, when it differs from the sale's own
   * contract currency (not the shop's display currency) — shows
   * "To'langan: <native>" + "Shartnomaga qo'llandi: <applied>" instead of one
   * figure, so a USD payment applied to a UZS sale (or vice versa) is
   * unambiguous. Omit when payment currency matches contract currency
   * (nothing was converted).
   */
  paymentInput?: { amount: number; currency: CurrencyCode } | null
}): string {
  const displayCurrency = data.currency?.currency ?? 'UZS'
  const contractMoney = (amount: number) => formatContractMoneyWithDisplay(amount, data.contractCurrency, displayCurrency, data.currency?.usdUzsRate)
  const paidLines =
    data.paymentInput && data.paymentInput.currency !== data.contractCurrency
      ? [
          `To'langan: ${formatNativeAmount(data.paymentInput.amount, data.paymentInput.currency)}`,
          `Shartnomaga qo'llandi: ${contractMoney(data.paidAmount)}`,
        ]
      : [`To'langan: ${contractMoney(data.paidAmount)}`]
  return compose(
    "💰 Qarz to'lovi qabul qilindi",
    optionalLine("Do'kon", data.shopName),
    block(optionalLine('Mijoz', data.customerName), optionalLine('Tel', data.customerPhone)),
    formatDeviceSpecs(data.device, { battery: false }),
    block(
      ...paidLines,
      optionalLine("To'lov usuli", formatPaymentMethod(data.paymentMethod)),
      `Qolgan qarz: ${data.remaining <= 0 ? "To'liq yopildi" : contractMoney(data.remaining)}`,
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
  currency?: CurrencyContext | null
}): string {
  return compose(
    "⏰ Bugun qarz to'lovi kuni",
    block(optionalLine('Mijoz', data.customerName), optionalLine('Tel', data.customerPhone)),
    formatDeviceSpecs(data.device, { battery: false }),
    block(`To'lov summasi: ${telegramMoney(data.remainingAmount, data.currency)}`, `Muddat: ${formatUzDate(data.dueDate)}`),
  )
}

export function saleOverdueMessage(data: {
  customerName: string
  customerPhone?: string | null
  device: DeviceSpecs
  remainingAmount: number
  dueDate: Date | string
  daysLate: number
  currency?: CurrencyContext | null
}): string {
  return compose(
    "⚠️ Qarz to'lovi muddati o'tgan",
    block(optionalLine('Mijoz', data.customerName), optionalLine('Tel', data.customerPhone)),
    formatDeviceSpecs(data.device, { battery: false }),
    block(
      `Qolgan qarz: ${telegramMoney(data.remainingAmount, data.currency)}`,
      `Muddat: ${formatUzDate(data.dueDate)}`,
      `Kechikkan: ${data.daysLate} kun`,
    ),
  )
}

// ---------------------------------------------------------------------------
// Early reminders — "Ertaroq eslatilsinmi?" (N days before the due-day
// reminder above). The due-day message still fires separately on the day.
// ---------------------------------------------------------------------------

export function nasiyaEarlyReminderMessage(data: {
  customerName: string
  customerPhone?: string | null
  device: DeviceSpecs
  month?: number | null
  /** The schedule's own contract-currency outstanding balance — see docs/currency-accounting-model.md. */
  amountDue: number
  contractCurrency: CurrencyCode
  dueDate: Date | string
  daysLeft: number
  currency?: CurrencyContext | null
}): string {
  return compose(
    "🔔 Nasiya to'lovi yaqinlashmoqda",
    block(optionalLine('Mijoz', data.customerName), optionalLine('Tel', data.customerPhone)),
    formatDeviceSpecs(data.device, { battery: false }),
    block(
      typeof data.month === 'number' ? `Oy: ${data.month}-oy` : null,
      `To'lov summasi: ${formatContractMoneyWithDisplay(data.amountDue, data.contractCurrency, data.currency?.currency ?? 'UZS', data.currency?.usdUzsRate)}`,
      `Muddat: ${formatUzDate(data.dueDate)}`,
      `Qoldi: ${data.daysLeft} kun`,
    ),
  )
}

export function saleEarlyReminderMessage(data: {
  customerName: string
  customerPhone?: string | null
  device: DeviceSpecs
  remainingAmount: number
  dueDate: Date | string
  daysLeft: number
  currency?: CurrencyContext | null
}): string {
  return compose(
    "🔔 Qarz to'lovi yaqinlashmoqda",
    block(optionalLine('Mijoz', data.customerName), optionalLine('Tel', data.customerPhone)),
    formatDeviceSpecs(data.device, { battery: false }),
    block(
      `To'lov summasi: ${telegramMoney(data.remainingAmount, data.currency)}`,
      `Muddat: ${formatUzDate(data.dueDate)}`,
      `Qoldi: ${data.daysLeft} kun`,
    ),
  )
}

/** Sent once, the moment a nasiya's status transitions to COMPLETED. */
export function nasiyaCompletedMessage(data: {
  shopName: string
  customerName: string
  customerPhone?: string | null
  device: DeviceSpecs
  /** The nasiya's own contract-currency total — see docs/currency-accounting-model.md. */
  finalNasiyaAmount: number
  contractCurrency: CurrencyCode
  adminName?: string | null
  currency?: CurrencyContext | null
}): string {
  return compose(
    '✅ Nasiya yakunlandi',
    optionalLine("Do'kon", data.shopName),
    block(optionalLine('Mijoz', data.customerName), optionalLine('Tel', data.customerPhone)),
    formatDeviceSpecs(data.device, { battery: false }),
    `Jami to'langan: ${formatContractMoneyWithDisplay(data.finalNasiyaAmount, data.contractCurrency, data.currency?.currency ?? 'UZS', data.currency?.usdUzsRate)}`,
    optionalLine('Admin', data.adminName),
  )
}

// ---------------------------------------------------------------------------
// Olib-sotdim — source a device from another shop/person and sell it to our
// customer in the same operation. Supplier debt (what WE owe) is always
// worded distinctly from customer debt (what the customer owes US) so an
// admin can never confuse the two in a Telegram message.
// ---------------------------------------------------------------------------

export function olibSotdimCreatedMessage(data: {
  shopName: string
  device: DeviceSpecs
  supplierName: string
  supplierPhone?: string | null
  supplierLocation?: string | null
  /** Purchase/sale/profit are all in this same contract currency by construction (one shared inputCurrency for the operation). */
  purchasePrice: number
  salePrice: number
  profit: number
  contractCurrency: CurrencyCode
  supplierPaidNow: boolean
  customerName: string
  customerPhone?: string | null
  adminName?: string | null
  currency?: CurrencyContext | null
}): string {
  const contractMoney = (amount: number) =>
    formatContractMoneyWithDisplay(amount, data.contractCurrency, data.currency?.currency ?? 'UZS', data.currency?.usdUzsRate)
  return compose(
    '🔄 Olib-sotdim: yangi operatsiya',
    optionalLine("Do'kon", data.shopName),
    formatDeviceSpecs(data.device),
    block(
      optionalLine('Kimdan olindi', data.supplierName),
      optionalLine('Yetkazib beruvchi tel', data.supplierPhone),
      optionalLine('Manzil', data.supplierLocation),
    ),
    block(optionalLine('Mijoz', data.customerName), optionalLine('Tel', data.customerPhone)),
    block(
      `Olingan narx: ${contractMoney(data.purchasePrice)}`,
      `Sotilgan narx: ${contractMoney(data.salePrice)}`,
      data.supplierPaidNow
        ? `Foyda: ${contractMoney(data.profit)}`
        : `Kutilayotgan foyda: ${contractMoney(data.profit)} (yetkazib beruvchiga hali to'lanmagan)`,
      `Yetkazib beruvchiga to'lov: ${data.supplierPaidNow ? 'hozir to\'landi' : "keyinroq to'lanadi"}`,
    ),
    optionalLine('Admin', data.adminName),
  )
}

function supplierPayableIntro(data: { supplierName: string; supplierPhone?: string | null }): string[] {
  return [optionalLine('Kimdan olindi', data.supplierName), optionalLine('Yetkazib beruvchi tel', data.supplierPhone)].filter(
    (l): l is string => l !== null,
  )
}

export function supplierPayableDueTodayMessage(data: {
  device: DeviceSpecs
  supplierName: string
  supplierPhone?: string | null
  /** The payable's own contract-currency amount — see docs/currency-accounting-model.md. */
  amount: number
  contractCurrency: CurrencyCode
  dueDate: Date | string
  currency?: CurrencyContext | null
}): string {
  return compose(
    "⏰ Eslatma: yetkazib beruvchiga to'lov",
    formatDeviceSpecs(data.device, { battery: false }),
    supplierPayableIntro(data),
    block(
      `To'lanadigan summa: ${formatContractMoneyWithDisplay(data.amount, data.contractCurrency, data.currency?.currency ?? 'UZS', data.currency?.usdUzsRate)}`,
      `Muddat: ${formatUzDate(data.dueDate)}`,
    ),
  )
}

export function supplierPayableOverdueMessage(data: {
  device: DeviceSpecs
  supplierName: string
  supplierPhone?: string | null
  /** The payable's own contract-currency amount — see docs/currency-accounting-model.md. */
  amount: number
  contractCurrency: CurrencyCode
  dueDate: Date | string
  daysLate: number
  currency?: CurrencyContext | null
}): string {
  return compose(
    "⚠️ Yetkazib beruvchiga to'lov muddati o'tdi",
    formatDeviceSpecs(data.device, { battery: false }),
    supplierPayableIntro(data),
    block(
      `To'lanadigan summa: ${formatContractMoneyWithDisplay(data.amount, data.contractCurrency, data.currency?.currency ?? 'UZS', data.currency?.usdUzsRate)}`,
      `Muddat: ${formatUzDate(data.dueDate)}`,
      `Kechikkan: ${data.daysLate} kun`,
    ),
  )
}

export function supplierPayableEarlyReminderMessage(data: {
  device: DeviceSpecs
  supplierName: string
  supplierPhone?: string | null
  /** The payable's own contract-currency amount — see docs/currency-accounting-model.md. */
  amount: number
  contractCurrency: CurrencyCode
  dueDate: Date | string
  daysLeft: number
  currency?: CurrencyContext | null
}): string {
  return compose(
    "🔔 Eslatma: yetkazib beruvchiga to'lov yaqinlashmoqda",
    formatDeviceSpecs(data.device, { battery: false }),
    supplierPayableIntro(data),
    block(
      `To'lanadigan summa: ${formatContractMoneyWithDisplay(data.amount, data.contractCurrency, data.currency?.currency ?? 'UZS', data.currency?.usdUzsRate)}`,
      `Muddat: ${formatUzDate(data.dueDate)}`,
      `${data.daysLeft} kun oldin eslatma`,
    ),
  )
}

export function supplierPayablePaidMessage(data: {
  shopName: string
  device: DeviceSpecs
  supplierName: string
  supplierPhone?: string | null
  /** The payable's own contract-currency amount — see docs/currency-accounting-model.md. */
  amount: number
  contractCurrency: CurrencyCode
  paymentMethod?: string | null
  adminName?: string | null
  currency?: CurrencyContext | null
}): string {
  return compose(
    "✅ Yetkazib beruvchiga to'lov qilindi",
    optionalLine("Do'kon", data.shopName),
    formatDeviceSpecs(data.device, { battery: false }),
    supplierPayableIntro(data),
    block(
      `To'langan summa: ${formatContractMoneyWithDisplay(data.amount, data.contractCurrency, data.currency?.currency ?? 'UZS', data.currency?.usdUzsRate)}`,
      optionalLine("To'lov usuli", formatPaymentMethod(data.paymentMethod)),
    ),
    optionalLine('Admin', data.adminName),
  )
}
