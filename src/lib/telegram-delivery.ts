/** Pure Telegram delivery planning. No DB/network dependencies. */

export const TELEGRAM_CAPTION_LIMIT = 1024
export const TELEGRAM_MEDIA_GROUP_LIMIT = 10

export type TelegramMediaItem = { position: number; imageUrl: string }

export type TelegramDeliveryStep =
  | { method: 'message'; text: string }
  | { method: 'photo'; item: TelegramMediaItem; caption?: string }
  | { method: 'mediaGroup'; items: TelegramMediaItem[]; caption?: string }

/**
 * Plan an ordered delivery without dropping media:
 * - zero images: text
 * - one image: photo
 * - 2..10: media group
 * - 11+: groups of ten, with a final singleton sent as a photo
 * A long caption is sent once as a full message before captionless media.
 */
export function planTelegramDelivery(input: {
  images: TelegramMediaItem[]
  caption: string
  textAlreadySent?: boolean
}): TelegramDeliveryStep[] {
  const images = [...input.images].sort((a, b) => a.position - b.position)
  if (images.length === 0) {
    return input.textAlreadySent ? [] : [{ method: 'message', text: input.caption }]
  }

  const captionFits = input.caption.length <= TELEGRAM_CAPTION_LIMIT
  const steps: TelegramDeliveryStep[] = []
  if (!captionFits && !input.textAlreadySent) steps.push({ method: 'message', text: input.caption })

  for (let index = 0; index < images.length; index += TELEGRAM_MEDIA_GROUP_LIMIT) {
    const items = images.slice(index, index + TELEGRAM_MEDIA_GROUP_LIMIT)
    const caption = captionFits && !input.textAlreadySent && index === 0 ? input.caption : undefined
    if (items.length === 1) steps.push({ method: 'photo', item: items[0], caption })
    else steps.push({ method: 'mediaGroup', items, caption })
  }
  return steps
}

/** Back-compatible single-image adapter retained for callers/tests. */
export function chooseTelegramDelivery(input: { imageUrl?: string | null; caption: string }) {
  const step = planTelegramDelivery({
    images: input.imageUrl ? [{ position: 0, imageUrl: input.imageUrl }] : [],
    caption: input.caption,
  })[0]
  if (step?.method === 'photo') return { method: 'photo' as const, imageUrl: step.item.imageUrl, caption: step.caption ?? '' }
  return { method: 'message' as const, text: input.caption }
}
