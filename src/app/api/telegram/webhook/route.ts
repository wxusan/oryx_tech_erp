/**
 * POST /api/telegram/webhook
 *
 * Receives Telegram Update objects from the Telegram Bot API.
 * Grammy's bot.handleUpdate() processes each update; command handlers
 * are registered below.
 *
 * Security:
 *   - Validates the X-Telegram-Bot-Api-Secret-Token header against
 *     TELEGRAM_WEBHOOK_SECRET before processing any update.
 *
 * Registration:
 *   Set the webhook with:
 *     curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
 *       -d url=https://<your-domain>/api/telegram/webhook \
 *       -d secret_token=<TELEGRAM_WEBHOOK_SECRET>
 */

import { type NextRequest } from 'next/server'
import { bot } from '@/lib/telegram'

// ---------------------------------------------------------------------------
// Register bot command handlers (runs once at module load)
// ---------------------------------------------------------------------------

bot.command('start', async (ctx) => {
  const telegramId = ctx.from?.id?.toString() ?? 'unknown'

  // [PRISMA] Optionally persist / update the admin's telegramId here:
  // await prisma.shopAdmin.updateMany({
  //   where: { telegramId },
  //   data:  { telegramId },   // already set — or use a verification flow
  // })

  await ctx.reply(
    "Salom\\! Siz *Oryx ERP* botiga ulandingiz\\. " +
    "Sizga tegishli do'kon operatsiyalari haqida xabar berib turaman\\.",
    { parse_mode: 'MarkdownV2' },
  )

  console.log(`[TelegramWebhook] /start from telegramId=${telegramId}`)
})

// Catch-all for unknown commands
bot.on('message', async (ctx) => {
  // Only reply to text messages that look like an unrecognised command
  const text = ctx.message.text ?? ''
  if (text.startsWith('/')) {
    await ctx.reply('Bu buyruq mavjud emas.')
  }
  // Non-command messages are silently ignored
})

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest): Promise<Response> {
  // --- Secret token verification ---
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET
  if (!secret) {
    console.warn('[TelegramWebhook] TELEGRAM_WEBHOOK_SECRET is not configured')
    return new Response('Webhook secret is not configured', { status: 503 })
  }

  const incoming = request.headers.get('x-telegram-bot-api-secret-token')
  if (incoming !== secret) {
    console.warn('[TelegramWebhook] Invalid or missing secret token')
    return new Response('Unauthorized', { status: 401 })
  }

  // --- Parse body ---
  let update: unknown
  try {
    update = await request.json()
  } catch {
    return new Response('Bad Request: invalid JSON', { status: 400 })
  }

  // --- Dispatch to Grammy ---
  try {
    // bot.handleUpdate accepts the raw Telegram Update object.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await bot.handleUpdate(update as any)
  } catch (error) {
    console.error('[TelegramWebhook] handleUpdate error:', error)
    // Always return 200 to Telegram so it does not retry indefinitely.
  }

  return new Response('OK', { status: 200 })
}
