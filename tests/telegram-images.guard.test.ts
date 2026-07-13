import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

describe('centralized image-aware Telegram delivery', () => {
  const telegram = read('src/lib/telegram.ts')
  const service = read('src/lib/notification-service.ts')

  it('telegram.ts exposes photo and media-group helpers alongside sendMessage', () => {
    expect(telegram).toContain('export async function sendTelegramPhoto')
    expect(telegram).toContain('api.sendPhoto(')
    expect(telegram).toContain('export async function sendTelegramMediaGroup')
    expect(telegram).toContain('api.sendMediaGroup(')
  })

  it('uses Telegram HTML parse mode for messages and photo captions', () => {
    expect(telegram).toContain("sendMessage(telegramId, text, { parse_mode: 'HTML' })")
    expect(telegram).toContain("caption ? { caption, parse_mode: 'HTML' } : undefined")
  })

  it('the queue processor snapshots every safe image and plans every chunk', () => {
    expect(service).toContain('resolveNotificationImageKeys(notification)')
    expect(service).toContain('resolveNotificationImageUrls(notification.shopId, mediaKeys, pendingPositions)')
    expect(service).toContain('planTelegramDelivery({ images, caption: notification.message')
    expect(service).toContain('sendTelegramPhoto(')
    expect(service).toContain('sendTelegramMediaGroup(')
  })

  it('a failed photo send falls back to a plain text message (never drops the notification)', () => {
    expect(service).toContain('const fallbackAllowed = unresolvedCount > 0 || (')
    expect(service).toContain("failedMethod !== 'message'")
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
    expect(img).toContain('const prefix = `shops/${shopId}/devices/`')
    expect(img).toContain("!objectName.includes('/')")
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
