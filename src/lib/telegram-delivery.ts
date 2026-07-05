/**
 * Pure decision: given a resolved (safe) image URL and a caption, decide whether
 * a notification goes out as a Telegram PHOTO (image + caption) or a plain
 * MESSAGE. Kept side-effect free so it is trivially unit-testable; the actual
 * sending + image resolution live in server modules.
 *
 * Rules:
 *   - Photo only when a safe image URL exists AND the caption fits Telegram's
 *     photo-caption limit (1024). Otherwise send the full text as a message
 *     (4096 limit) so nothing is ever truncated or dropped.
 */

// Telegram hard limits.
export const TELEGRAM_CAPTION_LIMIT = 1024

export type TelegramDeliveryPlan =
  | { method: 'photo'; imageUrl: string; caption: string }
  | { method: 'message'; text: string }

export function chooseTelegramDelivery(input: {
  imageUrl?: string | null
  caption: string
}): TelegramDeliveryPlan {
  const { imageUrl, caption } = input
  if (imageUrl && caption.length <= TELEGRAM_CAPTION_LIMIT) {
    return { method: 'photo', imageUrl, caption }
  }
  return { method: 'message', text: caption }
}
