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
 * Send a plain-text message to a single Telegram user.
 *
 * Sent WITHOUT parse_mode — message bodies are plain text (see
 * `@/lib/telegram-templates`). Returns { ok: true } on success, or
 * { ok: false, errorCode, description } on any error (network, blocked bot, …).
 * grammy's GrammyError carries the Telegram API error_code + description, which
 * we surface for observability.
 */
export async function sendTelegramMessage(
  telegramId: string,
  text: string,
): Promise<TelegramSendResult> {
  try {
    await getBot().api.sendMessage(telegramId, text)
    return { ok: true }
  } catch (error) {
    return handleSendError('sendMessage', error)
  }
}

/**
 * Send a photo with an optional caption to a single Telegram user.
 *
 * `photoUrl` MUST be a URL Telegram can fetch (e.g. a short-lived signed URL) —
 * never a permanent private URL. The caption is the same plain text a message
 * would carry (no parse_mode). Same result contract as sendTelegramMessage.
 */
export async function sendTelegramPhoto(
  telegramId: string,
  photoUrl: string,
  caption?: string,
): Promise<TelegramSendResult> {
  try {
    await getBot().api.sendPhoto(telegramId, photoUrl, caption ? { caption } : undefined)
    return { ok: true }
  } catch (error) {
    return handleSendError('sendPhoto', error)
  }
}

function handleSendError(method: 'sendMessage' | 'sendPhoto', error: unknown): TelegramSendResult {
  const anyErr = error as { error_code?: number; description?: string }
  const errorCode = typeof anyErr?.error_code === 'number' ? anyErr.error_code : undefined
  const description = typeof anyErr?.description === 'string' ? anyErr.description : undefined
  // Redacting logger — never prints the bot token even if it appears in a URL.
  logger.warn(`Telegram ${method} failed`, {
    event: 'telegram.send_failed',
    entityType: 'Telegram',
    errorCode,
    error,
  })
  return { ok: false, errorCode, description }
}
