import { describe, it, expect } from 'vitest'
import { getDeviceImageSrc } from '@/lib/device-image'

describe('getDeviceImageSrc', () => {
  it('proxies a raw private-storage object key through the uploads endpoint', () => {
    expect(getDeviceImageSrc('shops/shop-1/devices/abc.jpg')).toBe(
      '/api/uploads/device?key=shops%2Fshop-1%2Fdevices%2Fabc.jpg',
    )
  })

  it('collapses an already-absolute uploads-endpoint URL back to its path + query', () => {
    expect(getDeviceImageSrc('https://example.com/api/uploads/device?key=shops%2Fshop-1%2Fdevices%2Fabc.jpg')).toBe(
      '/api/uploads/device?key=shops%2Fshop-1%2Fdevices%2Fabc.jpg',
    )
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
