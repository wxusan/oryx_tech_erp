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
import { getBot } from '@/lib/telegram'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { recordOpsEvent } from '@/lib/server/ops-events'
import { findTelegramOwner } from '@/lib/telegram-id'
import {
  startShopAdminMessage,
  startSuperAdminMessage,
  startUnknownMessage,
  unknownCommandMessage,
} from '@/lib/telegram-templates'

// ---------------------------------------------------------------------------
// Register bot command handlers (runs once at module load)
// ---------------------------------------------------------------------------

let registeredBot: ReturnType<typeof getBot> | null = null

function webhookBot() {
  if (registeredBot) return registeredBot

  const bot = getBot()

  bot.command('start', async (ctx) => {
    const telegramId = ctx.from?.id?.toString()

    if (!telegramId) {
      await ctx.reply("Telegram ID aniqlanmadi. Iltimos, botni shaxsiy akkauntingizdan oching.")
      return
    }

    const owner = await findTelegramOwner(telegramId)
    if (!owner) {
      await ctx.reply(startUnknownMessage(telegramId))
      logger.info('telegram /start from unlinked id', { event: 'telegram.start_unlinked' })
      return
    }

    // Mark the manually-entered ID as verified on first /start (idempotent —
    // only writes when telegramVerifiedAt is still null). Never blocks the
    // welcome reply if the stamp fails.
    try {
      if (owner.type === 'SUPER_ADMIN') {
        await prisma.superAdmin.updateMany({
          where: { id: owner.user.id, telegramId, telegramVerifiedAt: null },
          data: { telegramVerifiedAt: new Date() },
        })
      } else {
        await prisma.shopAdmin.updateMany({
          where: { id: owner.user.id, telegramId, telegramVerifiedAt: null },
          data: { telegramVerifiedAt: new Date() },
        })
      }
    } catch (error) {
      logger.warn('telegram /start verify stamp failed', {
        event: 'telegram.verify_stamp_failed',
        actorId: owner.user.id,
        actorType: owner.type,
        error,
      })
    }

    const welcome =
      owner.type === 'SUPER_ADMIN'
        ? startSuperAdminMessage(owner.user.name)
        : startShopAdminMessage(owner.user.name, owner.user.shop.name)
    await ctx.reply(welcome)

    logger.info('telegram /start linked', { event: 'telegram.start', actorType: owner.type })
  })

  bot.on('message', async (ctx) => {
    const text = ctx.message.text ?? ''
    if (text.startsWith('/')) {
      await ctx.reply(unknownCommandMessage())
    }
  })

  registeredBot = bot
  return bot
}

/**
 * Return a command-registered bot that is guaranteed to be initialised.
 *
 * grammy's `handleUpdate()` throws "Bot not initialized!" unless `botInfo` is
 * known — in webhook mode we must call `bot.init()` ourselves (it is
 * idempotent and only performs one getMe per warm instance). Without this,
 * EVERY inbound command (/start, fallback) silently throws before its
 * handler runs, which is why the bot never welcomed linked users.
 */
async function ensureWebhookBot() {
  const bot = webhookBot()
  if (!bot.isInited()) {
    await bot.init()
  }
  return bot
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest): Promise<Response> {
  // --- Secret token verification ---
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET
  if (!secret) {
    logger.warn('telegram webhook secret not configured', { event: 'telegram.webhook_misconfigured' })
    return new Response('Webhook secret is not configured', { status: 503 })
  }

  const incoming = request.headers.get('x-telegram-bot-api-secret-token')
  if (incoming !== secret) {
    logger.warn('telegram webhook rejected invalid secret token', { event: 'telegram.webhook_unauthorized' })
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
    // The bot must be initialised before handleUpdate (see ensureWebhookBot).
    const bot = await ensureWebhookBot()
    // bot.handleUpdate accepts the raw Telegram Update object.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await bot.handleUpdate(update as any)
  } catch (error) {
    // Persist webhook command failures — otherwise a broken /start is
    // invisible until a user complains.
    await recordOpsEvent({
      level: 'ERROR',
      event: 'telegram.webhook_error',
      message: 'Telegram handleUpdate failed',
      status: 'error',
      metadata: { error: error instanceof Error ? error.message : String(error) },
    })
    // Always return 200 to Telegram so it does not retry indefinitely.
  }

  return new Response('OK', { status: 200 })
}
