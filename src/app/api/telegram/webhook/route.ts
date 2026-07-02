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
import {
  buildStartWelcome,
  findTelegramOwner,
  isTelegramIdTaken,
  START_NOT_LINKED_MESSAGE,
} from '@/lib/telegram-id'

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
      await ctx.reply(START_NOT_LINKED_MESSAGE)
      console.log(`[TelegramWebhook] /start not linked telegramId=${telegramId}`)
      return
    }

    // Mark the manually-entered ID as verified on first /start (idempotent —
    // only writes when telegramVerifiedAt is still null). Never blocks the
    // welcome reply if the stamp fails.
    try {
      if (owner.type === 'SUPER_ADMIN') {
        await prisma.superAdmin.updateMany({
          where: { id: owner.user.id, telegramVerifiedAt: null },
          data: { telegramVerifiedAt: new Date() },
        })
      } else {
        await prisma.shopAdmin.updateMany({
          where: { id: owner.user.id, telegramVerifiedAt: null },
          data: { telegramVerifiedAt: new Date() },
        })
      }
    } catch (error) {
      console.error(`[TelegramWebhook] /start verify stamp failed telegramId=${telegramId}:`, error)
    }

    await ctx.reply(buildStartWelcome(owner))

    console.log(`[TelegramWebhook] /start from telegramId=${telegramId} type=${owner.type}`)
  })

  bot.command('link', async (ctx) => {
    const telegramId = ctx.from?.id?.toString()
    const code = ctx.match?.trim().toUpperCase()
    if (!telegramId || !code) {
      await ctx.reply("Ulash uchun: /link KOD")
      return
    }

    const adminToLink = await prisma.shopAdmin.findFirst({
      where: {
        telegramLinkCode: code,
        deletedAt: null,
        isActive: true,
      },
      select: { id: true },
    })

    if (!adminToLink) {
      await ctx.reply("Kod topilmadi yoki allaqachon ishlatilgan.")
      return
    }

    if (await isTelegramIdTaken(telegramId, { type: 'SHOP_ADMIN', id: adminToLink.id })) {
      await ctx.reply("Bu Telegram ID boshqa hisobga ulangan.")
      return
    }

    const updated = await prisma.shopAdmin.updateMany({
      where: {
        telegramLinkCode: code,
        id: adminToLink.id,
        deletedAt: null,
        isActive: true,
      },
      data: {
        telegramId,
        telegramVerifiedAt: new Date(),
        telegramLinkCode: null,
      },
    })

    if (updated.count !== 1) {
      await ctx.reply("Kod topilmadi yoki allaqachon ishlatilgan.")
      return
    }

    // Send the shop-specific welcome (falls back to a generic confirmation if
    // the freshly-linked admin can't be re-read for any reason).
    const owner = await findTelegramOwner(telegramId)
    await ctx.reply(owner ? buildStartWelcome(owner) : 'Telegram akkauntingiz Oryx ERP bilan ulandi.')
    console.log(`[TelegramWebhook] /link success telegramId=${telegramId}`)
  })

  bot.on('message', async (ctx) => {
    const text = ctx.message.text ?? ''
    if (text.startsWith('/')) {
      await ctx.reply('Bu buyruq mavjud emas.')
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
 * EVERY inbound command (/start, /link, fallback) silently throws before its
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
    // The bot must be initialised before handleUpdate (see ensureWebhookBot).
    const bot = await ensureWebhookBot()
    // bot.handleUpdate accepts the raw Telegram Update object.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await bot.handleUpdate(update as any)
  } catch (error) {
    console.error('[TelegramWebhook] handleUpdate error:', error)
    // Always return 200 to Telegram so it does not retry indefinitely.
  }

  return new Response('OK', { status: 200 })
}
