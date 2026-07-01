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
import { findTelegramOwner, isTelegramIdTaken } from '@/lib/telegram-id'

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
      await ctx.reply("Kechirasiz, bu Telegram ID Oryx ERP tizimida ro'yxatdan o'tmagan.")
      console.log(`[TelegramWebhook] /start denied telegramId=${telegramId}`)
      return
    }

    if (owner.type === 'SUPER_ADMIN') {
      await ctx.reply(`Salom, ${owner.user.name}! Siz Oryx ERP super admini sifatida ulandingiz.`)
    } else {
      await ctx.reply(
        `Salom, ${owner.user.name}! Siz ${owner.user.shop.name} do'koni admini sifatida ulandingiz. ` +
          "Shu do'konga tegishli xabarlar shu yerga keladi.",
      )
    }

    console.log(`[TelegramWebhook] /start from telegramId=${telegramId}`)
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

    await ctx.reply("Telegram akkauntingiz Oryx ERP bilan ulandi.")
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
    await webhookBot().handleUpdate(update as any)
  } catch (error) {
    console.error('[TelegramWebhook] handleUpdate error:', error)
    // Always return 200 to Telegram so it does not retry indefinitely.
  }

  return new Response('OK', { status: 200 })
}
