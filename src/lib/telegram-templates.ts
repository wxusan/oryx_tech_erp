/**
 * Centralized Telegram message templates for Oryx ERP.
 *
 * Rules (enforced by tests):
 *   - Pure functions, typed input, NO DB queries here.
 *   - Telegram HTML: bold title only; body remains normal-weight.
 *   - Every dynamic text value is escaped before interpolation.
 *   - Consistent Uzbek wording + money/date formatting.
 *   - Optional lines are omitted cleanly (never "undefined"/"null").
 *   - Never include raw DB IDs, passport URLs, tokens, secrets, or logins.
 */

import { uzDate } from '@/lib/dates'
import { telegramImei } from '@/lib/device-display'
import { formatUserFacingMoney, type CurrencyContext, type CurrencyCode } from '@/lib/currency'
import { formatContractMoneyWithDisplay } from '@/lib/nasiya-contract'

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/** "8 500 000 so'm" (ru-RU groups with spaces). */
export function formatMoney(value: number | string | null | undefined): string {
  const n = Number(value ?? 0)
  return `${(Number.isFinite(n) ? n : 0).toLocaleString('ru-RU')} so‘m`
}

function telegramTypography(value: string): string {
  return value.replaceAll("so'm", 'so‘m')
}

function telegramMoney(value: number | string | null | undefined, currency?: CurrencyContext | null): string {
  if (!currency) return formatMoney(value)
  return telegramTypography(
    formatUserFacingMoney({
      amount: value,
      amountCurrency: 'UZS',
      displayCurrency: currency.currency,
      rate: currency.usdUzsRate,
    }),
  )
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
      return 'O‘tkazma'
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

/** Escape a dynamic value before inserting it into a Telegram HTML message. */
export function escapeTelegramHtml(value: string | number): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/** `${icon} ${label}: ${escapedValue}` when present; otherwise omit cleanly. */
export function optionalLine(label: string, value?: string | number | null, icon?: string): string | null {
  if (value === null || value === undefined) return null
  const str = String(value).trim()
  return str.length > 0 ? `${icon ? `${icon} ` : ''}${label}: ${escapeTelegramHtml(str)}` : null
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
    optionalLine('Qurilma', device.deviceModel, '📱'),
    optionalLine('Xotira', device.storage, '💾'),
    optionalLine('Rang', device.color, '🎨'),
    includeBattery && typeof device.batteryHealth === 'number' ? `🔋 Batareya: ${escapeTelegramHtml(device.batteryHealth)}%` : null,
    optionalLine('IMEI', telegramImei(device.imei), '🔢'),
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

function contractMoney(
  amount: number | string,
  contractCurrency: CurrencyCode,
  currency?: CurrencyContext | null,
  rateOverride?: number | string | null,
): string {
  return telegramTypography(
    formatContractMoneyWithDisplay(amount, contractCurrency, currency?.currency ?? 'UZS', rateOverride ?? currency?.usdUzsRate),
  )
}

// ---------------------------------------------------------------------------
// Bot direct replies
// ---------------------------------------------------------------------------

export function telegramIdUnavailableMessage(): string {
  return compose('<b>⚠️ Telegram ID aniqlanmadi</b>', 'Iltimos, botni shaxsiy Telegram akkauntingizdan oching.')
}

export function startSuperAdminMessage(adminName: string): string {
  return compose(
    '<b>👋 Oryx ERP botiga xush kelibsiz</b>',
    optionalLine('Admin', adminName, '👨‍💼'),
    'Siz Oryx ERP super admin sifatida ulandingiz.',
    'Endi platformadagi muhim bildirishnomalar shu bot orqali keladi.',
  )
}

export function startShopAdminMessage(adminName: string, shopName: string): string {
  return compose(
    '<b>👋 Oryx ERP botiga xush kelibsiz</b>',
    block(optionalLine('Admin', adminName, '👨‍💼'), optionalLine('Do‘kon', shopName, '🏪')),
    'Siz do‘kon bildirishnomalariga muvaffaqiyatli ulandingiz.',
    'Endi sotuv, nasiya, to‘lov va eslatmalar shu yerga keladi.',
  )
}

export function startUnknownMessage(telegramId: string): string {
  return compose(
    '<b>⚠️ Telegram akkaunt ulanmagan</b>',
    'Telegram akkauntingiz Oryx ERP hisobiga ulanmagan.',
    'Iltimos, admin panelda Telegram ID’ingiz to‘g‘ri kiritilganini tekshiring.',
    optionalLine('Telegram ID', telegramId, '🆔'),
  )
}

export function unknownCommandMessage(): string {
  return compose('<b>❓ Buyruq topilmadi</b>', 'Botdan foydalanish uchun /start buyrug‘ini yuboring.')
}

// ---------------------------------------------------------------------------
// Device messages
// ---------------------------------------------------------------------------

export function deviceAddedMessage(data: {
  shopName: string
  device: DeviceSpecs
  /** The device's own purchase-currency amount — see docs/currency-accounting-model.md. */
  purchasePrice: number
  purchaseCurrency: CurrencyCode
  supplierPhone?: string | null
  adminName?: string | null
  currency?: CurrencyContext | null
}): string {
  return compose(
    '<b>📦 Yangi qurilma qo‘shildi</b>',
    optionalLine('Do‘kon', data.shopName, '🏪'),
    formatDeviceSpecs(data.device),
    block(
      `💵 Olingan narx: ${contractMoney(data.purchasePrice, data.purchaseCurrency, data.currency)}`,
      optionalLine('Yetkazib beruvchi', data.supplierPhone, '📞'),
    ),
    optionalLine('Admin', data.adminName, '👨‍💼'),
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
  /** Item 14 — sale margin in the same contract currency, when computable (see computeSaleContractMargin). Omitted rather than guessed when unavailable. */
  profit?: number | null
}): string {
  const money = (amount: number) => contractMoney(amount, data.contractCurrency, data.currency)
  return compose(
    '<b>✅ Qurilma sotildi</b>',
    optionalLine('Do‘kon', data.shopName, '🏪'),
    formatDeviceSpecs(data.device),
    block(optionalLine('Mijoz', data.customerName, '👤'), optionalLine('Tel', data.customerPhone, '📞')),
    block(
      `💵 Sotilish narxi: ${money(data.salePrice)}`,
      `💰 To‘langan: ${money(data.paidAmount)}`,
      `⏳ Qolgan qarz: ${data.remaining <= 0 ? 'Yo‘q' : money(data.remaining)}`,
      optionalLine('To‘lov usuli', formatPaymentMethod(data.paymentMethod), '💳'),
      typeof data.profit === 'number' ? `📊 Foyda: ${money(data.profit)}` : null,
    ),
    optionalLine('Admin', data.adminName, '👨‍💼'),
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
    '<b>↩️ Qurilma qaytarildi</b>',
    optionalLine('Do‘kon', data.shopName, '🏪'),
    formatDeviceSpecs(data.device),
    block(
      `💵 Qaytarilgan summa: ${telegramMoney(data.refundAmount, data.currency)}`,
      showMethod ? optionalLine('Qaytarish usuli', formatPaymentMethod(data.refundMethod), '💳') : null,
    ),
    block(optionalLine('Izoh', cleanNote(data.note), '📝'), optionalLine('Admin', data.adminName, '👨‍💼')),
  )
}

export function deviceRestockedMessage(data: { shopName: string; device: DeviceSpecs; note: string; adminName?: string | null }): string {
  return compose(
    '<b>🔄 Qurilma qayta sotuvga chiqarildi</b>',
    optionalLine('Do‘kon', data.shopName, '🏪'),
    formatDeviceSpecs(data.device),
    block(optionalLine('Izoh', cleanNote(data.note), '📝'), optionalLine('Admin', data.adminName, '👨‍💼')),
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
        `💵 Sotilish narxi: ${telegramMoney(data.totalAmount, data.currency)}`,
        `💰 Boshlang‘ich to‘lov: ${telegramMoney(data.downPayment, data.currency)}`,
        `⏳ Qolgan qarz: ${telegramMoney(data.baseRemainingAmount, data.currency)}`,
      )
    : block(
        `💵 Sotilish narxi: ${telegramMoney(data.totalAmount, data.currency)}`,
        `💰 Boshlang‘ich to‘lov: ${telegramMoney(data.downPayment, data.currency)}`,
        `📊 Nasiya jami: ${telegramMoney(data.finalNasiyaAmount, data.currency)}`,
      )
  const interestBlock = hasInterest
    ? block(
        `📈 Nasiya foizi: ${escapeTelegramHtml(data.interestPercent)}%`,
        `➕ Foiz summasi: ${telegramMoney(data.interestAmount, data.currency)}`,
        `📊 Nasiya jami: ${telegramMoney(data.finalNasiyaAmount, data.currency)}`,
      )
    : null
  return compose(
    '<b>📝 Yangi nasiya yaratildi</b>',
    optionalLine('Do‘kon', data.shopName, '🏪'),
    block(optionalLine('Mijoz', data.customerName, '👤'), optionalLine('Tel', data.customerPhone, '📞')),
    formatDeviceSpecs(data.device),
    moneyBlock,
    interestBlock,
    block(
      `📅 Muddat: ${escapeTelegramHtml(data.months)} oy`,
      `💵 Oylik to‘lov: ${telegramMoney(data.monthlyPayment, data.currency)}`,
      data.nextPaymentDate ? `🗓 Keyingi to‘lov: ${formatUzDate(data.nextPaymentDate)}` : null,
    ),
    optionalLine('Admin', data.adminName, '👨‍💼'),
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
   * What the customer actually entered. User-facing Telegram shows it in the
   * shop display currency only; `paymentExchangeRate` is used when converting
   * this historical payment for display.
   */
  paymentInput?: { amount: number; currency: CurrencyCode } | null
  paymentExchangeRate?: number | string | null
  /** Item 12 — split payment breakdown (e.g. half cash, half card). */
  paymentBreakdown?: { method: string; amount: number }[] | null
}): string {
  const monthLine =
    data.month === 'MULTIPLE'
      ? '📆 Oy: Bir nechta oy'
      : typeof data.month === 'number'
        ? `📆 Oy: ${escapeTelegramHtml(data.month)}-oy`
        : null
  const displayCurrency = data.currency?.currency ?? 'UZS'
  const money = (amount: number) => contractMoney(amount, data.contractCurrency, data.currency)
  const paymentRate = data.paymentExchangeRate ?? data.currency?.usdUzsRate
  const historicalContractMoney = (amount: number) => contractMoney(amount, data.contractCurrency, data.currency, paymentRate)
  const paymentInputMoney = data.paymentInput
    ? telegramTypography(
        formatUserFacingMoney({
          amount: data.paymentInput.amount,
          amountCurrency: data.paymentInput.currency,
          displayCurrency,
          rate: paymentRate,
        }),
      )
    : historicalContractMoney(data.paidAmount)
  const allocationBlock =
    data.allocations && data.allocations.length > 1
      ? data.allocations.map((allocation, index) =>
          index === 0
            ? `• ${historicalContractMoney(allocation.amount)} joriy oy uchun yopildi`
            : `• ${historicalContractMoney(allocation.amount)} ${escapeTelegramHtml(allocation.monthNumber)}-oyga oldindan qo‘llandi`,
        )
      : null
  const paidLines = [`💰 To‘langan: ${paymentInputMoney}`]
  const paymentMethodLine = data.paymentBreakdown?.length
    ? formatPaymentBreakdown(data.paymentBreakdown, data.paymentInput?.currency ?? displayCurrency, displayCurrency, paymentRate)
    : optionalLine('To‘lov usuli', formatPaymentMethod(data.paymentMethod), '💳')
  return compose(
    '<b>💰 Nasiya to‘lovi qabul qilindi</b>',
    optionalLine('Do‘kon', data.shopName, '🏪'),
    block(optionalLine('Mijoz', data.customerName, '👤'), optionalLine('Tel', data.customerPhone, '📞')),
    formatDeviceSpecs(data.device, { battery: false }),
    block(monthLine, ...paidLines, paymentMethodLine, `⏳ Qolgan qarz: ${data.remaining <= 0 ? 'To‘liq yopildi' : money(data.remaining)}`),
    allocationBlock ? block('📋 To‘lov taqsimoti:', ...allocationBlock) : null,
    block(optionalLine('Izoh', cleanNote(data.note), '📝'), optionalLine('Admin', data.adminName, '👨‍💼')),
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
    '<b>⏰ Bugun to‘lov kuni</b>',
    block(optionalLine('Mijoz', data.customerName, '👤'), optionalLine('Tel', data.customerPhone, '📞')),
    formatDeviceSpecs(data.device, { battery: false }),
    block(
      typeof data.month === 'number' ? `📆 Oy: ${escapeTelegramHtml(data.month)}-oy` : null,
      `💵 To‘lov summasi: ${contractMoney(data.amountDue, data.contractCurrency, data.currency)}`,
      '📅 Muddat: Bugun',
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
    '<b>⚠️ To‘lov muddati o‘tgan</b>',
    block(optionalLine('Mijoz', data.customerName, '👤'), optionalLine('Tel', data.customerPhone, '📞')),
    formatDeviceSpecs(data.device, { battery: false }),
    block(
      typeof data.month === 'number' ? `📆 Oy: ${escapeTelegramHtml(data.month)}-oy` : null,
      `💵 Qolgan to‘lov: ${contractMoney(data.amountDue, data.contractCurrency, data.currency)}`,
      `📅 Muddat: ${formatUzDate(data.dueDate)}`,
      `⏳ Kechikkan: ${escapeTelegramHtml(data.daysLate)} kun`,
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
    '<b>📥 Eski nasiya import qilindi</b>',
    optionalLine('Do‘kon', data.shopName, '🏪'),
    block(optionalLine('Mijoz', data.customerName, '👤'), optionalLine('Tel', data.customerPhone, '📞')),
    formatDeviceSpecs(data.device, { battery: false }),
    block(
      `💵 Eski nasiya summasi: ${telegramMoney(data.originalTotalAmount, data.currency)}`,
      `💰 Importgacha to‘langan: ${telegramMoney(data.alreadyPaidBeforeImport, data.currency)}`,
      `⏳ Qolgan qarz: ${telegramMoney(data.remainingDebt, data.currency)}`,
    ),
    block(
      `💵 Oylik to‘lov: ${telegramMoney(data.monthlyPayment, data.currency)}`,
      `🗓 Keyingi to‘lov: ${formatUzDate(data.nextPaymentDate)}`,
    ),
    optionalLine('Admin', data.adminName, '👨‍💼'),
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
   * What the customer actually entered. User-facing Telegram shows it in the
   * shop display currency only; `paymentExchangeRate` is used when converting
   * this historical payment for display.
   */
  paymentInput?: { amount: number; currency: CurrencyCode } | null
  paymentExchangeRate?: number | string | null
  /** Item 12 — split payment breakdown (e.g. half cash, half card). */
  paymentBreakdown?: { method: string; amount: number }[] | null
}): string {
  const displayCurrency = data.currency?.currency ?? 'UZS'
  const money = (amount: number) => contractMoney(amount, data.contractCurrency, data.currency)
  const paymentRate = data.paymentExchangeRate ?? data.currency?.usdUzsRate
  const paidMoney = data.paymentInput
    ? telegramTypography(
        formatUserFacingMoney({
          amount: data.paymentInput.amount,
          amountCurrency: data.paymentInput.currency,
          displayCurrency,
          rate: paymentRate,
        }),
      )
    : contractMoney(data.paidAmount, data.contractCurrency, data.currency, paymentRate)
  const paidLines = [`💰 To‘langan: ${paidMoney}`]
  const paymentMethodLine = data.paymentBreakdown?.length
    ? formatPaymentBreakdown(data.paymentBreakdown, data.paymentInput?.currency ?? displayCurrency, displayCurrency, paymentRate)
    : optionalLine('To‘lov usuli', formatPaymentMethod(data.paymentMethod), '💳')
  return compose(
    '<b>💰 Qarz to‘lovi qabul qilindi</b>',
    optionalLine('Do‘kon', data.shopName, '🏪'),
    block(optionalLine('Mijoz', data.customerName, '👤'), optionalLine('Tel', data.customerPhone, '📞')),
    formatDeviceSpecs(data.device, { battery: false }),
    block(...paidLines, paymentMethodLine, `⏳ Qolgan qarz: ${data.remaining <= 0 ? 'To‘liq yopildi' : money(data.remaining)}`),
    block(optionalLine('Izoh', cleanNote(data.note), '📝'), optionalLine('Admin', data.adminName, '👨‍💼')),
  )
}

/** Readable multi-line split-payment breakdown. */
function formatPaymentBreakdown(
  parts: { method: string; amount: number }[],
  amountCurrency: CurrencyCode,
  displayCurrency: CurrencyCode,
  rate?: number | string | null,
): string {
  return block(
    '💳 To‘lov usuli:',
    ...parts.map(
      (part) =>
        `• ${formatPaymentMethod(part.method) ?? 'Boshqa'}: ${telegramTypography(
          formatUserFacingMoney({
            amount: part.amount,
            amountCurrency,
            displayCurrency,
            rate,
          }),
        )}`,
    ),
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
    '<b>⏰ Bugun to‘lov kuni</b>',
    block(optionalLine('Mijoz', data.customerName, '👤'), optionalLine('Tel', data.customerPhone, '📞')),
    formatDeviceSpecs(data.device, { battery: false }),
    block(`💵 To‘lov summasi: ${telegramMoney(data.remainingAmount, data.currency)}`, '📅 Muddat: Bugun'),
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
    '<b>⚠️ To‘lov muddati o‘tgan</b>',
    block(optionalLine('Mijoz', data.customerName, '👤'), optionalLine('Tel', data.customerPhone, '📞')),
    formatDeviceSpecs(data.device, { battery: false }),
    block(
      `💵 Qolgan to‘lov: ${telegramMoney(data.remainingAmount, data.currency)}`,
      `📅 Muddat: ${formatUzDate(data.dueDate)}`,
      `⏳ Kechikkan: ${escapeTelegramHtml(data.daysLate)} kun`,
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
    '<b>🔔 Nasiya to‘lovi yaqinlashmoqda</b>',
    block(optionalLine('Mijoz', data.customerName, '👤'), optionalLine('Tel', data.customerPhone, '📞')),
    formatDeviceSpecs(data.device, { battery: false }),
    block(
      typeof data.month === 'number' ? `📆 Oy: ${escapeTelegramHtml(data.month)}-oy` : null,
      `💵 To‘lov summasi: ${contractMoney(data.amountDue, data.contractCurrency, data.currency)}`,
      `📅 Muddat: ${formatUzDate(data.dueDate)}`,
      `⏳ Qoldi: ${escapeTelegramHtml(data.daysLeft)} kun`,
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
    '<b>🔔 Qarz to‘lovi yaqinlashmoqda</b>',
    block(optionalLine('Mijoz', data.customerName, '👤'), optionalLine('Tel', data.customerPhone, '📞')),
    formatDeviceSpecs(data.device, { battery: false }),
    block(
      `💵 To‘lov summasi: ${telegramMoney(data.remainingAmount, data.currency)}`,
      `📅 Muddat: ${formatUzDate(data.dueDate)}`,
      `⏳ Qoldi: ${escapeTelegramHtml(data.daysLeft)} kun`,
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
    '<b>✅ Nasiya yakunlandi</b>',
    optionalLine('Do‘kon', data.shopName, '🏪'),
    block(optionalLine('Mijoz', data.customerName, '👤'), optionalLine('Tel', data.customerPhone, '📞')),
    formatDeviceSpecs(data.device, { battery: false }),
    `💰 Jami to‘langan: ${contractMoney(data.finalNasiyaAmount, data.contractCurrency, data.currency)}`,
    optionalLine('Admin', data.adminName, '👨‍💼'),
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
  const money = (amount: number) => contractMoney(amount, data.contractCurrency, data.currency)
  return compose(
    '<b>🔄 Olib-sotdim operatsiyasi</b>',
    optionalLine('Do‘kon', data.shopName, '🏪'),
    formatDeviceSpecs(data.device),
    block(
      optionalLine('Kimdan olindi', data.supplierName, '🏬'),
      optionalLine('Yetkazib beruvchi', data.supplierPhone, '📞'),
      optionalLine('Manzil', data.supplierLocation, '📍'),
    ),
    block(optionalLine('Mijoz', data.customerName, '👤'), optionalLine('Tel', data.customerPhone, '📞')),
    block(
      `💵 Olingan narx: ${money(data.purchasePrice)}`,
      `💰 Sotilish narxi: ${money(data.salePrice)}`,
      data.supplierPaidNow
        ? `📊 Foyda: ${money(data.profit)}`
        : `📊 Kutilayotgan foyda: ${money(data.profit)} (yetkazib beruvchiga hali to‘lanmagan)`,
      `💳 Yetkazib beruvchiga to‘lov: ${data.supplierPaidNow ? 'hozir to‘landi' : 'keyinroq to‘lanadi'}`,
    ),
    optionalLine('Admin', data.adminName, '👨‍💼'),
  )
}

function supplierPayableIntro(data: { supplierName: string; supplierPhone?: string | null }): string[] {
  return [optionalLine('Kimdan olindi', data.supplierName, '🏬'), optionalLine('Yetkazib beruvchi', data.supplierPhone, '📞')].filter(
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
    '<b>📌 Yetkazib beruvchiga to‘lov</b>',
    formatDeviceSpecs(data.device, { battery: false }),
    supplierPayableIntro(data),
    block(`💵 To‘lov summasi: ${contractMoney(data.amount, data.contractCurrency, data.currency)}`, '📅 Muddat: Bugun'),
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
    '<b>⚠️ Yetkazib beruvchiga to‘lov muddati o‘tgan</b>',
    formatDeviceSpecs(data.device, { battery: false }),
    supplierPayableIntro(data),
    block(
      `💵 Qolgan to‘lov: ${contractMoney(data.amount, data.contractCurrency, data.currency)}`,
      `📅 Muddat: ${formatUzDate(data.dueDate)}`,
      `⏳ Kechikkan: ${escapeTelegramHtml(data.daysLate)} kun`,
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
    '<b>🔔 Yetkazib beruvchiga to‘lov yaqinlashmoqda</b>',
    formatDeviceSpecs(data.device, { battery: false }),
    supplierPayableIntro(data),
    block(
      `💵 To‘lov summasi: ${contractMoney(data.amount, data.contractCurrency, data.currency)}`,
      `📅 Muddat: ${formatUzDate(data.dueDate)}`,
      `⏳ Qoldi: ${escapeTelegramHtml(data.daysLeft)} kun`,
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
    '<b>✅ Yetkazib beruvchiga to‘lov qilindi</b>',
    optionalLine('Do‘kon', data.shopName, '🏪'),
    formatDeviceSpecs(data.device, { battery: false }),
    supplierPayableIntro(data),
    block(
      `💰 To‘langan: ${contractMoney(data.amount, data.contractCurrency, data.currency)}`,
      optionalLine('To‘lov usuli', formatPaymentMethod(data.paymentMethod), '💳'),
    ),
    optionalLine('Admin', data.adminName, '👨‍💼'),
  )
}
