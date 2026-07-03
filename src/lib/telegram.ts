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
