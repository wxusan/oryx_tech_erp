import { describe, expect, it } from 'vitest'
import { hasValidImageSignature } from '@/lib/server/image-signature'

describe('hasValidImageSignature', () => {
  it('accepts JPEG, PNG and WEBP magic bytes', () => {
    expect(hasValidImageSignature(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), 'image/jpeg')).toBe(true)
    expect(hasValidImageSignature(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'image/png')).toBe(true)
    expect(hasValidImageSignature(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]), 'image/webp')).toBe(true)
  })

  it('rejects spoofed text/svg/html payloads even with image MIME types', () => {
    const svg = new TextEncoder().encode('<svg onload=alert(1)>')
    const html = new TextEncoder().encode('<html></html>')

    expect(hasValidImageSignature(svg, 'image/png')).toBe(false)
    expect(hasValidImageSignature(html, 'image/jpeg')).toBe(false)
    expect(hasValidImageSignature(svg, 'image/svg+xml')).toBe(false)
  })
})
