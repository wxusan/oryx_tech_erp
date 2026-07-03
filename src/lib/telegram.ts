import { Bot } from 'grammy'
import { logger } from '@/lib/logger'

// ---------------------------------------------------------------------------
// Bot instance — shared across the application
// ---------------------------------------------------------------------------

let cachedBot: Bot | null = null

export function getBot(): Bot {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN is required')
  }

  cachedBot ??= new Bot(token)
  return cachedBot
}

// ---------------------------------------------------------------------------
// Core send helper
// ---------------------------------------------------------------------------

export interface TelegramSendResult {
  ok: boolean
  errorCode?: number
  description?: string
}

/**
 * Send a Markdown message to a single Telegram user.
 * Returns { ok: true } on success, or { ok: false, errorCode, description } on
 * any error (network, blocked bot, etc.). grammy's GrammyError carries the
 * Telegram API error_code + description, which we surface for observability.
 */
export async function sendTelegramMessage(
  telegramId: string,
  text: string,
): Promise<TelegramSendResult> {
  try {
    await getBot().api.sendMessage(telegramId, text)
    return { ok: true }
  } catch (error) {
    const anyErr = error as { error_code?: number; description?: string }
    const errorCode = typeof anyErr?.error_code === 'number' ? anyErr.error_code : undefined
    const description = typeof anyErr?.description === 'string' ? anyErr.description : undefined
    // Redacting logger — never prints the bot token even if it appears in a URL.
    logger.warn('Telegram sendMessage failed', {
      event: 'telegram.send_failed',
      entityType: 'Telegram',
      errorCode,
      error,
    })
    return { ok: false, errorCode, description }
  }
}

// ---------------------------------------------------------------------------
// Shared formatting helpers
// ---------------------------------------------------------------------------

/** Format a Date as "YYYY-MM-DD HH:mm" in Tashkent local time (UTC+5). */
function formatDateTime(date: Date): string {
  return date.toLocaleString('uz-UZ', {
    timeZone: 'Asia/Tashkent',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

/** Format a Date as "YYYY-MM-DD" in Tashkent local time. */
function formatDate(date: Date): string {
  return date.toLocaleDateString('uz-UZ', {
    timeZone: 'Asia/Tashkent',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
}

/** Format a number as "1,500,000 so'm". */
function formatAmount(amount: number): string {
  return `${amount.toLocaleString('ru-RU')} so'm`
}

// ---------------------------------------------------------------------------
// Notification formatters
// ---------------------------------------------------------------------------

/**
 * Device sold for cash / transfer / card.
 *
 * ✅ *Yangi sotuv*
 *
 * 🏪 Do'kon: Malika Electronics
 * 📱 Qurilma: iPhone 13 Pro (256GB)
 * 📋 IMEI: 123456789012345
 * 👤 Mijoz: Alisher Karimov
 * 📞 Tel: +998901234567
 * 💰 Narx: 8,500,000 so'm
 * 💳 To'lov: Naqd
 * 📝 Izoh: ...
 *
 * ⏰ 2024-01-15 14:30
 */
export function formatSaleNotification(data: {
  shopName: string
  deviceModel: string
  imei: string
  customerName: string
  customerPhone: string
  amount: number
  paymentMethod: string
  note?: string
}): string {
  const now = formatDateTime(new Date())
  const lines: string[] = [
    '✅ *Yangi sotuv*',
    '',
    `🏪 Do'kon: ${data.shopName}`,
    `📱 Qurilma: ${data.deviceModel}`,
    `📋 IMEI: ${data.imei}`,
    `👤 Mijoz: ${data.customerName}`,
    `📞 Tel: ${data.customerPhone}`,
    `💰 Narx: ${formatAmount(data.amount)}`,
    `💳 To'lov: ${data.paymentMethod}`,
  ]

  if (data.note) {
    lines.push(`📝 Izoh: ${data.note}`)
  }

  lines.push('', `⏰ ${now}`)
  return lines.join('\n')
}

/**
 * New device added to stock.
 *
 * 📦 *Yangi qurilma qo'shildi*
 *
 * 🏪 Do'kon: Malika Electronics
 * 📱 Qurilma: Samsung Galaxy S23
 * 📋 IMEI: 123456789012345
 * 💵 Kelish narxi: 6,000,000 so'm
 * 🏭 Ta'minotchi: Sarvar Ulgurji
 * 👤 Qo'shdi: Admin
 *
 * ⏰ 2024-01-15 10:00
 */
export function formatNewDeviceNotification(data: {
  shopName: string
  deviceModel: string
  imei: string
  purchasePrice: number
  supplierName?: string
  addedBy: string
}): string {
  const now = formatDateTime(new Date())
  const lines: string[] = [
    "📦 *Yangi qurilma qo'shildi*",
    '',
    `🏪 Do'kon: ${data.shopName}`,
    `📱 Qurilma: ${data.deviceModel}`,
    `📋 IMEI: ${data.imei}`,
    `💵 Kelish narxi: ${formatAmount(data.purchasePrice)}`,
  ]

  if (data.supplierName) {
    lines.push(`🏭 Ta'minotchi: ${data.supplierName}`)
  }

  lines.push(`👤 Qo'shdi: ${data.addedBy}`, '', `⏰ ${now}`)
  return lines.join('\n')
}

/**
 * New nasiya (instalment plan) created.
 *
 * 📋 *Yangi nasiya rasmiylashtirildi*
 *
 * 🏪 Do'kon: Malika Electronics
 * 📱 Qurilma: iPhone 14
 * 👤 Mijoz: Nodira Rahimova
 * 📞 Tel: +998901234567
 * 💰 Jami narx: 12,000,000 so'm
 * 💵 Boshlang'ich to'lov: 3,000,000 so'm
 * 📌 Qolgan summa: 9,000,000 so'm
 * 📅 Muddati: 9 oy
 * 🔁 Oylik to'lov: 1,000,000 so'm
 * 📆 Birinchi to'lov: 2024-02-15
 *
 * ⏰ 2024-01-15 11:30
 */
export function formatNasiyaNotification(data: {
  shopName: string
  deviceModel: string
  customerName: string
  customerPhone: string
  totalAmount: number
  downPayment: number
  baseRemainingAmount?: number
  interestPercent?: number
  interestAmount?: number
  finalNasiyaAmount?: number
  months: number
  monthlyPayment: number
  firstDueDate: Date
}): string {
  const now = formatDateTime(new Date())
  const lines: string[] = [
    '📋 *Yangi nasiya rasmiylashtirildi*',
    '',
    `🏪 Do'kon: ${data.shopName}`,
    `📱 Qurilma: ${data.deviceModel}`,
    `👤 Mijoz: ${data.customerName}`,
    `📞 Tel: ${data.customerPhone}`,
    `💰 Jami narx: ${formatAmount(data.totalAmount)}`,
    `💵 Boshlang'ich to'lov: ${formatAmount(data.downPayment)}`,
    `📌 Qolgan summa: ${formatAmount(data.baseRemainingAmount ?? Math.max(0, data.totalAmount - data.downPayment))}`,
    ...(data.interestPercent && data.interestPercent > 0
      ? [
          `📈 Nasiya foizi: ${data.interestPercent}%`,
          `➕ Foiz summasi: ${formatAmount(data.interestAmount ?? 0)}`,
        ]
      : []),
    `🧾 Nasiya jami: ${formatAmount(data.finalNasiyaAmount ?? Math.max(0, data.totalAmount - data.downPayment))}`,
    `📅 Muddati: ${data.months} oy`,
    `🔁 Oylik to'lov: ${formatAmount(data.monthlyPayment)}`,
    `📆 Birinchi to'lov: ${formatDate(data.firstDueDate)}`,
    '',
    `⏰ ${now}`,
  ]
  return lines.join('\n')
}

/**
 * Nasiya monthly payment received.
 *
 * 💳 *Nasiya to'lovi qabul qilindi*
 *
 * 🏪 Do'kon: Malika Electronics
 * 📱 Qurilma: iPhone 14
 * 👤 Mijoz: Nodira Rahimova
 * 💰 To'langan: 1,000,000 so'm
 * 🔖 Qoldiq: 8,000,000 so'm
 * 📆 Keyingi to'lov: 2024-03-15
 *
 * ⏰ 2024-02-15 09:45
 */
export function formatNasiyaPaymentNotification(data: {
  shopName: string
  deviceModel: string
  customerName: string
  amount: number
  remaining: number
  nextDueDate?: Date
}): string {
  const now = formatDateTime(new Date())
  const lines: string[] = [
    "💳 *Nasiya to'lovi qabul qilindi*",
    '',
    `🏪 Do'kon: ${data.shopName}`,
    `📱 Qurilma: ${data.deviceModel}`,
    `👤 Mijoz: ${data.customerName}`,
    `💰 To'langan: ${formatAmount(data.amount)}`,
    `🔖 Qoldiq: ${formatAmount(data.remaining)}`,
  ]

  if (data.nextDueDate) {
    lines.push(`📆 Keyingi to'lov: ${formatDate(data.nextDueDate)}`)
  } else {
    lines.push('✅ Nasiya to\'liq yopildi!')
  }

  lines.push('', `⏰ ${now}`)
  return lines.join('\n')
}

/**
 * Payment reminder (due today).
 *
 * 🔔 *To'lov eslatmasi*
 *
 * 🏪 Do'kon: Malika Electronics
 * 📱 Qurilma: iPhone 14
 * 👤 Mijoz: Nodira Rahimova
 * 📞 Tel: +998901234567
 * 💰 To'lov miqdori: 1,000,000 so'm
 * 📆 Muddat: 2024-02-15
 *
 * ⚠️ Bugun to'lov kuni!
 */
export function formatPaymentReminderNotification(data: {
  shopName: string
  deviceModel: string
  customerName: string
  customerPhone: string
  amount: number
  dueDate: Date
}): string {
  const lines: string[] = [
    "🔔 *To'lov eslatmasi*",
    '',
    `🏪 Do'kon: ${data.shopName}`,
    `📱 Qurilma: ${data.deviceModel}`,
    `👤 Mijoz: ${data.customerName}`,
    `📞 Tel: ${data.customerPhone}`,
    `💰 To'lov miqdori: ${formatAmount(data.amount)}`,
    `📆 Muddat: ${formatDate(data.dueDate)}`,
    '',
    "⚠️ Bugun to'lov kuni!",
  ]
  return lines.join('\n')
}

/**
 * Overdue payment notification.
 *
 * 🚨 *To'lov muddati o'tdi*
 *
 * 🏪 Do'kon: Malika Electronics
 * 📱 Qurilma: iPhone 14
 * 👤 Mijoz: Nodira Rahimova
 * 📞 Tel: +998901234567
 * 💰 Miqdor: 1,000,000 so'm
 * 📆 Muddat: 2024-02-10
 * ⏳ Kechikish: 5 kun
 *
 * ❗ Iltimos, tezroq bog'laning!
 */
export function formatOverdueNotification(data: {
  shopName: string
  deviceModel: string
  customerName: string
  customerPhone: string
  amount: number
  overdueDate: Date
  daysOverdue: number
}): string {
  const lines: string[] = [
    "🚨 *To'lov muddati o'tdi*",
    '',
    `🏪 Do'kon: ${data.shopName}`,
    `📱 Qurilma: ${data.deviceModel}`,
    `👤 Mijoz: ${data.customerName}`,
    `📞 Tel: ${data.customerPhone}`,
    `💰 Miqdor: ${formatAmount(data.amount)}`,
    `📆 Muddat: ${formatDate(data.overdueDate)}`,
    `⏳ Kechikish: ${data.daysOverdue} kun`,
    '',
    "❗ Iltimos, tezroq bog'laning!",
  ]
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Plain-text event notifications
//
// These are built in the same plain-text (no Markdown) style as the inline
// messages produced by the sale / cron routes, because sendTelegramMessage()
// sends without parse_mode — any `*asterisks*` would show up literally.
// ---------------------------------------------------------------------------

/** Uzbek label for a payment/refund method enum value. */
export function paymentMethodLabel(method?: string | null): string {
  switch (method) {
    case 'CASH':
      return 'Naqd'
    case 'TRANSFER':
      return "O'tkazma"
    case 'CARD':
      return 'Karta'
    case 'OTHER':
      return 'Boshqa'
    default:
      return '-'
  }
}

/**
 * Device returned (Qaytarish). Includes refund details, reason, and actor.
 *
 * ↩️ Qurilma qaytarildi
 * 📱 iPhone 13 Pro
 * 📋 IMEI: 123456789012345
 * 💸 Qaytarilgan summa: 8,500,000 so'm
 * 💳 Usul: Naqd
 * 📝 Sabab: mijoz bekor qildi
 * 👤 Admin: Dilshod
 */
export function formatDeviceReturnNotification(data: {
  deviceModel: string
  imei: string
  refundAmount: number
  refundMethod?: string | null
  note: string
  actorName?: string
}): string {
  const lines: string[] = [
    '↩️ Qurilma qaytarildi',
    `📱 ${data.deviceModel}`,
    `📋 IMEI: ${data.imei}`,
    `💸 Qaytarilgan summa: ${formatAmount(data.refundAmount)}`,
  ]

  if (data.refundAmount > 0) {
    lines.push(`💳 Usul: ${paymentMethodLabel(data.refundMethod)}`)
  }

  lines.push(`📝 Sabab: ${data.note}`)

  if (data.actorName) {
    lines.push(`👤 Admin: ${data.actorName}`)
  }

  return lines.join('\n')
}

/**
 * Returned device put back on sale (Sotuvga chiqarish / restock).
 *
 * 📦 Qurilma qayta sotuvga chiqarildi
 * 📱 iPhone 13 Pro
 * 📋 IMEI: 123456789012345
 * 📝 Sabab: qayta ko'rikdan o'tdi
 * 👤 Admin: Dilshod
 */
export function formatDeviceRestockNotification(data: {
  deviceModel: string
  imei: string
  note: string
  actorName?: string
}): string {
  const lines: string[] = [
    '📦 Qurilma qayta sotuvga chiqarildi',
    `📱 ${data.deviceModel}`,
    `📋 IMEI: ${data.imei}`,
    `📝 Sabab: ${data.note}`,
  ]

  if (data.actorName) {
    lines.push(`👤 Admin: ${data.actorName}`)
  }

  return lines.join('\n')
}
