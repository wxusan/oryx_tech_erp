import { describe, it, expect } from 'vitest'
import { getDeviceImageSrc } from '@/lib/device-image'

describe('getDeviceImageSrc', () => {
  it('never turns a raw private-storage object key into a browser URL', () => {
    expect(getDeviceImageSrc('shops/shop-1/devices/abc.jpg')).toBe('')
  })

  it('normalizes an opaque reference proxy URL to a same-origin URL', () => {
    expect(getDeviceImageSrc('https://example.com/api/uploads/device?reference=v1.opaque.token')).toBe(
      '/api/uploads/device?reference=v1.opaque.token',
    )
  })

  it('rejects a legacy proxy URL that exposes the storage key', () => {
    expect(getDeviceImageSrc('https://example.com/api/uploads/device?key=shops%2Fshop-1%2Fdevices%2Fabc.jpg')).toBe('')
  })

  it('returns an unrelated absolute URL unchanged', () => {
    const url = 'https://cdn.example.com/some-other-image.jpg'
    expect(getDeviceImageSrc(url)).toBe(url)
  })

  it('returns malformed/non-URL data as-is so broken rows stay visible in QA', () => {
    expect(getDeviceImageSrc('not a url at all')).toBe('not a url at all')
  })

  it('returns an empty string unchanged', () => {
    expect(getDeviceImageSrc('')).toBe('')
  })
})
