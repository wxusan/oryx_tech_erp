import { afterEach, describe, it, expect, vi } from 'vitest'
import { logger, redact, serializeError } from '../src/lib/logger'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('logger redaction', () => {
  it('redacts sensitive keys regardless of value', () => {
    const out = redact({
      password: 'hunter2',
      passwordHash: '$2b$12$abc',
      token: 'abc',
      secret: 'shh',
      authorization: 'Bearer x',
      cookie: 'session=1',
      TELEGRAM_BOT_TOKEN: '123:AAABBB',
      keep: 'visible',
    }) as Record<string, string>

    expect(out.password).toBe('[redacted]')
    expect(out.passwordHash).toBe('[redacted]')
    expect(out.token).toBe('[redacted]')
    expect(out.secret).toBe('[redacted]')
    expect(out.authorization).toBe('[redacted]')
    expect(out.cookie).toBe('[redacted]')
    expect(out.TELEGRAM_BOT_TOKEN).toBe('[redacted]')
    expect(out.keep).toBe('visible')
  })

  it('redacts secret-shaped VALUES even under harmless keys', () => {
    const out = redact({
      dsn: 'postgresql://user:pass@db.supabase.com:5432/postgres',
      note: 'contact 12345',
    }) as Record<string, string>
    expect(out.dsn).toBe('[redacted]')
    expect(out.note).toBe('contact 12345')
  })

  it('strips a Telegram bot token embedded in a free-text string', () => {
    const out = redact({ url: 'https://api.telegram.org/bot123456:AAH-abcdefghijklmnopqrstuvwxyz012345/sendMessage' }) as Record<string, string>
    expect(out.url).not.toContain('AAH-abcdefghijklmnopqrstuvwxyz')
    expect(out.url).toContain('[redacted]')
  })

  it('drops the query string of signed storage URLs', () => {
    const out = redact({
      photo: 'https://xyz.supabase.co/storage/v1/object/sign/passports/abc.jpg?token=eyJhbGciOi.secretpart',
    }) as Record<string, string>
    expect(out.photo).not.toContain('secretpart')
    expect(out.photo).toContain('[redacted]')
  })

  it('redacts a signed URL embedded in free text without dropping the message', () => {
    const out = redact({
      detail: 'download failed at https://example.test/private/a.jpg?x=1&X-Amz-Signature=secret-value retrying',
    }) as Record<string, string>
    expect(out.detail).toBe('download failed at https://example.test/private/a.jpg?[redacted] retrying')
  })

  it('redacts bearer credentials in free text', () => {
    const out = redact({ detail: 'upstream said Authorization: Bearer abc.def-123' }) as Record<string, string>
    expect(out.detail).toBe('upstream said Authorization: Bearer [redacted]')
  })

  it('redacts the top-level logger message, not only its context', () => {
    vi.stubEnv('NODE_ENV', 'production')
    const output = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    logger.info('failed https://example.test/x?token=do-not-log')
    const line = JSON.parse(String(output.mock.calls[0]?.[0])) as { message: string }
    expect(line.message).toBe('failed https://example.test/x?[redacted]')
  })

  it('recurses into nested objects and arrays', () => {
    const out = redact({ a: { b: { password: 'x', ok: 1 } }, list: [{ token: 't' }] }) as {
      a: { b: { password: string; ok: number } }
      list: { token: string }[]
    }
    expect(out.a.b.password).toBe('[redacted]')
    expect(out.a.b.ok).toBe(1)
    expect(out.list[0].token).toBe('[redacted]')
  })
})

describe('logger error serialization', () => {
  it('serializes name + message and never throws', () => {
    const err = new Error('boom')
    const out = serializeError(err)
    expect(out.name).toBe('Error')
    expect(out.message).toBe('boom')
  })

  it('captures a grammy-style Telegram error code/description', () => {
    const err = Object.assign(new Error('Forbidden'), { error_code: 403, description: 'bot was blocked by the user' })
    const out = serializeError(err)
    expect(out.errorCode).toBe(403)
    expect(out.description).toBe('bot was blocked by the user')
  })

  it('redacts a connection string that appears inside an error message', () => {
    const err = new Error('connect failed postgresql://u:p@db.supabase.com/postgres')
    const out = serializeError(err)
    expect(String(out.message)).toBe('[redacted]')
  })

  it('handles non-Error input without throwing', () => {
    expect(serializeError('plain string').message).toBe('plain string')
    expect(serializeError(null).message).toBe('null')
  })

  it('redacts secrets in non-Error input', () => {
    expect(serializeError('Bearer secret-value').message).toBe('Bearer [redacted]')
  })
})
