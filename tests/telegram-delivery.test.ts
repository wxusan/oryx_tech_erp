import { describe, it, expect } from 'vitest'
import { chooseTelegramDelivery, TELEGRAM_CAPTION_LIMIT } from '@/lib/telegram-delivery'

describe('chooseTelegramDelivery (photo vs message)', () => {
  it('sends as a PHOTO with caption when a safe image exists and caption fits', () => {
    const plan = chooseTelegramDelivery({ imageUrl: 'https://signed.example/x.jpg', caption: 'Qurilma sotildi' })
    expect(plan).toEqual({ method: 'photo', imageUrl: 'https://signed.example/x.jpg', caption: 'Qurilma sotildi' })
  })

  it('falls back to a plain MESSAGE when there is no image', () => {
    const plan = chooseTelegramDelivery({ imageUrl: null, caption: 'Bugun to\'lov kuni' })
    expect(plan).toEqual({ method: 'message', text: 'Bugun to\'lov kuni' })
    expect(chooseTelegramDelivery({ caption: 'x' }).method).toBe('message')
  })

  it('falls back to a MESSAGE when the caption exceeds the photo caption limit', () => {
    const longCaption = 'x'.repeat(TELEGRAM_CAPTION_LIMIT + 1)
    const plan = chooseTelegramDelivery({ imageUrl: 'https://signed.example/x.jpg', caption: longCaption })
    expect(plan.method).toBe('message')
    if (plan.method === 'message') expect(plan.text).toBe(longCaption) // full text, never truncated
  })

  it('allows a caption exactly at the limit as a photo', () => {
    const caption = 'y'.repeat(TELEGRAM_CAPTION_LIMIT)
    expect(chooseTelegramDelivery({ imageUrl: 'u', caption }).method).toBe('photo')
  })
})
