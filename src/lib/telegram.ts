import { Bot } from 'grammy'

// ---------------------------------------------------------------------------
// Bot instance — shared across the application
// ---------------------------------------------------------------------------

export const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN!)

// ---------------------------------------------------------------------------
// Core send helper
// ---------------------------------------------------------------------------

/**
 * Send a Markdown message to a single Telegram user.
 * Returns true on success, false on any error (network, blocked bot, etc.)
 */
export async function sendTelegramMessage(
  telegramId: string,
  text: string,
): Promise<boolean> {
  try {
    await bot.api.sendMessage(telegramId, text)
    return true
  } catch (error) {
    console.error(`[Telegram] sendMessage failed (id=${telegramId}):`, error)
    return false
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
