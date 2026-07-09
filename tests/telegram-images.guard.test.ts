import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

describe('centralized image-aware Telegram delivery', () => {
  const telegram = read('src/lib/telegram.ts')
  const service = read('src/lib/notification-service.ts')

  it('telegram.ts exposes a sendPhoto helper alongside sendMessage', () => {
    expect(telegram).toContain('export async function sendTelegramPhoto')
    expect(telegram).toContain('api.sendPhoto(')
  })

  it('uses Telegram HTML parse mode for messages and photo captions', () => {
    expect(telegram).toContain("sendMessage(telegramId, text, { parse_mode: 'HTML' })")
    expect(telegram).toContain("caption ? { caption, parse_mode: 'HTML' } : undefined")
  })

  it('the queue processor resolves a safe image and chooses photo vs message', () => {
    expect(service).toContain('resolveNotificationImageUrl(notification)')
    expect(service).toContain('chooseTelegramDelivery({ imageUrl, caption: notification.message })')
    expect(service).toContain('sendTelegramPhoto(')
  })

  it('a failed photo send falls back to a plain text message (never drops the notification)', () => {
    expect(service).toContain("if (plan.method === 'photo' && !result.ok)")
    expect(service).toContain('sendTelegramMessage(notification.telegramId, notification.message)')
  })
})

describe('notification image privacy', () => {
  const img = read('src/lib/server/notification-image.ts')

  it('only ever attaches DEVICE photos — never passport / customer documents', () => {
    expect(img).not.toContain('passport')
    expect(img).not.toContain('Passport')
    // Reads only device imageUrls via the device relations.
    expect(img).toContain('imageUrls')
  })

  it('signs only keys under the device path (a passport key can never match)', () => {
    expect(img).toContain('/^shops\\/[^/]+\\/devices\\/[^/]+$/')
    expect(img).toContain('DEVICE_KEY_PATTERN.test(key)')
  })

  it('uses a short-lived signed URL and never persists a permanent public URL', () => {
    expect(img).toContain('createSignedUrl(key, SIGNED_URL_TTL_SECONDS)')
    expect(img).toContain('const SIGNED_URL_TTL_SECONDS')
  })

  it('never throws into delivery — any failure resolves to null (text fallback)', () => {
    expect(img).toContain('return null')
    expect(img).toContain('} catch {')
  })
})

describe('message text/caption never leaks a URL', () => {
  // The signed URL is passed as the photo argument, NOT embedded in the caption.
  // The caption is always the existing template message. This is enforced by the
  // template safety test (telegram.test.ts) which forbids http/https/signedUrl in
  // message bodies; here we assert the processor passes the message unchanged.
  const service = read('src/lib/notification-service.ts')
  it('the caption is the notification message, not a constructed string with a URL', () => {
    expect(service).toContain('caption: notification.message')
    expect(service).not.toContain('caption: `')
  })
})
