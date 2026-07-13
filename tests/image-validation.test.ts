import { beforeAll, describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'

vi.mock('server-only', () => ({}))

let validatePrivateUploadImage: typeof import('@/lib/server/image-validation').validatePrivateUploadImage

beforeAll(async () => {
  ;({ validatePrivateUploadImage } = await import('@/lib/server/image-validation'))
})

describe('private upload image decode validation', () => {
  it('accepts a fully decodable supported image', async () => {
    const image = await sharp({
      create: { width: 2, height: 3, channels: 3, background: '#ffffff' },
    }).png().toBuffer()
    await expect(validatePrivateUploadImage(image, 'image/png')).resolves.toEqual({
      ok: true,
      width: 2,
      height: 3,
    })
  })

  it('rejects a valid image whose claimed MIME type does not match', async () => {
    const image = await sharp({
      create: { width: 1, height: 1, channels: 3, background: '#ffffff' },
    }).png().toBuffer()
    await expect(validatePrivateUploadImage(image, 'image/jpeg')).resolves.toEqual({
      ok: false,
      reason: 'signature',
    })
  })

  it('rejects signature-only corrupted content', async () => {
    const truncatedJpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
    const result = await validatePrivateUploadImage(truncatedJpeg, 'image/jpeg')
    expect(result.ok).toBe(false)
  })

  it('rejects decoded dimensions beyond the configured bound', async () => {
    const image = await sharp({
      create: { width: 8_193, height: 1, channels: 3, background: '#ffffff' },
    }).png().toBuffer()
    await expect(validatePrivateUploadImage(image, 'image/png')).resolves.toEqual({
      ok: false,
      reason: 'dimensions',
    })
  })
})
