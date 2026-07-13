import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import {
  createPrivateUploadReference,
  privateUploadPreviewUrl,
  readPrivateUploadReference,
  resolvePrivateUploadReference,
} from '@/lib/server/private-upload-reference'

const SECRET = 'test-only-private-upload-reference-secret-32-bytes'
const NOW = new Date('2026-07-13T12:00:00.000Z')

describe('private upload browser references', () => {
  it('round-trips a tenant image without exposing its storage key in the token or URL', () => {
    const key = 'shops/shop-1/devices/private-device.jpg'
    const reference = createPrivateUploadReference({ key, shopId: 'shop-1', kind: 'device', now: NOW, secret: SECRET })
    const url = privateUploadPreviewUrl('device', reference)

    expect(reference).not.toContain('shops')
    expect(reference).not.toContain('private-device.jpg')
    expect(url).not.toContain(encodeURIComponent(key))
    expect(readPrivateUploadReference({ reference, kind: 'device', now: NOW, secret: SECRET })).toMatchObject({
      shopId: 'shop-1',
      key,
      kind: 'device',
    })
    expect(resolvePrivateUploadReference({ value: url, shopId: 'shop-1', kind: 'device', now: NOW, secret: SECRET })).toBe(key)
  })

  it('rejects cross-tenant, wrong-kind, expired, and tampered references', () => {
    const reference = createPrivateUploadReference({
      key: 'shops/shop-1/passports/private-passport.webp',
      shopId: 'shop-1',
      kind: 'passport',
      now: NOW,
      ttlMs: 1_000,
      secret: SECRET,
    })

    expect(resolvePrivateUploadReference({ value: reference, shopId: 'shop-2', kind: 'passport', now: NOW, secret: SECRET })).toBeNull()
    expect(readPrivateUploadReference({ reference, kind: 'device', now: NOW, secret: SECRET })).toBeNull()
    expect(readPrivateUploadReference({ reference, kind: 'passport', now: new Date(NOW.getTime() + 1_001), secret: SECRET })).toBeNull()
    expect(readPrivateUploadReference({ reference: `${reference}x`, kind: 'passport', now: NOW, secret: SECRET })).toBeNull()
  })

  it('accepts a tenant raw key only through the explicit legacy input path', () => {
    const key = 'shops/shop-1/devices/legacy.jpg'
    expect(resolvePrivateUploadReference({ value: key, shopId: 'shop-1', kind: 'device', allowLegacyRawKey: true, secret: SECRET })).toBe(key)
    expect(resolvePrivateUploadReference({ value: key, shopId: 'shop-1', kind: 'device', secret: SECRET })).toBeNull()
    expect(resolvePrivateUploadReference({ value: key, shopId: 'shop-2', kind: 'device', allowLegacyRawKey: true, secret: SECRET })).toBeNull()
  })
})
