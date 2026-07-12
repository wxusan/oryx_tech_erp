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
  retryAfterSeconds?: number
}

/**
 * Send a Telegram HTML message to a single Telegram user.
 *
 * Templates escape every dynamic value and use HTML only for a bold title.
 * Returns { ok: true } on success, or
 * { ok: false, errorCode, description } on any error (network, blocked bot, …).
 * grammy's GrammyError carries the Telegram API error_code + description, which
 * we surface for observability.
 */
export async function sendTelegramMessage(
  telegramId: string,
  text: string,
): Promise<TelegramSendResult> {
  try {
    await getBot().api.sendMessage(telegramId, text, { parse_mode: 'HTML' })
    return { ok: true }
  } catch (error) {
    return handleSendError('sendMessage', error)
  }
}

/**
 * Send a photo with an optional caption to a single Telegram user.
 *
 * `photoUrl` MUST be a URL Telegram can fetch (e.g. a short-lived signed URL) —
 * never a permanent private URL. The caption is the same HTML text a message
 * would carry, using the same parse mode. Same result contract as
 * sendTelegramMessage.
 */
export async function sendTelegramPhoto(
  telegramId: string,
  photoUrl: string,
  caption?: string,
): Promise<TelegramSendResult> {
  try {
    await getBot().api.sendPhoto(
      telegramId,
      photoUrl,
      caption ? { caption, parse_mode: 'HTML' } : undefined,
    )
    return { ok: true }
  } catch (error) {
    return handleSendError('sendPhoto', error)
  }
}

/** Telegram albums accept 2–10 items. The caption belongs only to item one. */
export async function sendTelegramMediaGroup(
  telegramId: string,
  photoUrls: string[],
  caption?: string,
): Promise<TelegramSendResult> {
  try {
    await getBot().api.sendMediaGroup(
      telegramId,
      photoUrls.map((media, index) => ({
        type: 'photo' as const,
        media,
        ...(index === 0 && caption ? { caption, parse_mode: 'HTML' as const } : {}),
      })),
    )
    return { ok: true }
  } catch (error) {
    return handleSendError('sendMediaGroup', error)
  }
}

function handleSendError(method: 'sendMessage' | 'sendPhoto' | 'sendMediaGroup', error: unknown): TelegramSendResult {
  const anyErr = error as { error_code?: number; description?: string; parameters?: { retry_after?: number } }
  const errorCode = typeof anyErr?.error_code === 'number' ? anyErr.error_code : undefined
  const description = typeof anyErr?.description === 'string' ? anyErr.description : undefined
  const retryAfterSeconds = typeof anyErr?.parameters?.retry_after === 'number' ? anyErr.parameters.retry_after : undefined
  // Redacting logger — never prints the bot token even if it appears in a URL.
  logger.warn(`Telegram ${method} failed`, {
    event: 'telegram.send_failed',
    entityType: 'Telegram',
    errorCode,
    error,
  })
  return { ok: false, errorCode, description, retryAfterSeconds }
}
