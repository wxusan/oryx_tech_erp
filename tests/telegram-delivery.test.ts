import { describe, it, expect } from 'vitest'
import { chooseTelegramDelivery, planTelegramDelivery, TELEGRAM_CAPTION_LIMIT } from '@/lib/telegram-delivery'

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

describe('planTelegramDelivery (all images)', () => {
  const images = (count: number) => Array.from({ length: count }, (_, position) => ({ position, imageUrl: `https://signed/${position}` }))

  it.each([0, 1, 2, 10, 11])('plans %i images without dropping any', (count) => {
    const plan = planTelegramDelivery({ images: images(count), caption: 'Xabar' })
    const delivered = plan.flatMap((step) => step.method === 'photo' ? [step.item] : step.method === 'mediaGroup' ? step.items : [])
    expect(delivered).toHaveLength(count)
    expect(delivered.map((item) => item.position)).toEqual(Array.from({ length: count }, (_, index) => index))
  })

  it('chunks eleven as ten plus a final photo and captions only the first media', () => {
    const plan = planTelegramDelivery({ images: images(11), caption: 'Xabar' })
    expect(plan.map((step) => step.method)).toEqual(['mediaGroup', 'photo'])
    expect(plan[0]).toMatchObject({ method: 'mediaGroup', caption: 'Xabar' })
    expect(plan[1]).toMatchObject({ method: 'photo', caption: undefined })
  })

  it('sends a long full message once and then captionless media', () => {
    const caption = 'x'.repeat(TELEGRAM_CAPTION_LIMIT + 1)
    const plan = planTelegramDelivery({ images: images(2), caption })
    expect(plan[0]).toEqual({ method: 'message', text: caption })
    expect(plan[1]).toMatchObject({ method: 'mediaGroup', caption: undefined })
  })

  it('retries only pending positions supplied by durable progress', () => {
    const plan = planTelegramDelivery({ images: images(11).slice(10), caption: 'Xabar', textAlreadySent: true })
    expect(plan).toEqual([{ method: 'photo', item: { position: 10, imageUrl: 'https://signed/10' }, caption: undefined }])
  })
})
