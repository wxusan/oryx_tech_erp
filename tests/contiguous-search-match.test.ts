import { describe, expect, it } from 'vitest'
import { matchesDeviceSearch, matchesNasiyaSearch } from '@/lib/search-match'

describe('contiguous free-text search semantics', () => {
  it('matches 2446 as one contiguous substring in model and note', () => {
    expect(matchesDeviceSearch({
      model: 'Galaxy 2446 Ultra',
      imei: '111111111111111',
      note: 'Qabul kodi: 2446',
    }, '2446')).toBe(true)
  })

  it.each([
    ['separated characters', '2xx4xx4xx6'],
    ['wrong order', '2464'],
  ])('does not treat %s as a match', (_label, value) => {
    expect(matchesDeviceSearch({
      model: value,
      imei: '111111111111111',
    }, '2446')).toBe(false)
  })

  it('does not assemble a match from fragments in different fields', () => {
    expect(matchesDeviceSearch({
      model: 'Model 24',
      imei: '111111111111111',
      note: 'Izoh 46',
      customerName: 'Mijoz 244',
      supplierName: '6',
    }, '2446')).toBe(false)
  })

  it('normalizes a formatted primary or secondary IMEI before matching', () => {
    expect(matchesDeviceSearch({
      model: 'Unrelated model',
      imei: '35 912-2446-789012',
    }, '359122446789012')).toBe(true)

    expect(matchesDeviceSearch({
      model: 'Unrelated model',
      imei: '111111111111111',
      imeis: [{ value: '86-001-2446-789012' }],
    } as Parameters<typeof matchesDeviceSearch>[0], '2446')).toBe(true)
  })

  it('matches partial primary and additional phone digits contiguously', () => {
    expect(matchesDeviceSearch({
      model: 'Unrelated model',
      imei: '111111111111111',
      customerPhone: '+998 90 124 46 78',
    } as Parameters<typeof matchesDeviceSearch>[0], '2446')).toBe(true)

    expect(matchesDeviceSearch({
      model: 'Unrelated model',
      imei: '111111111111111',
      additionalPhones: ['+998 (95) 002-44-67'],
    } as Parameters<typeof matchesDeviceSearch>[0], '2446')).toBe(true)
  })

  it('does not activate numeric fallback for a mixed model query', () => {
    expect(matchesDeviceSearch({
      model: 'Samsung S24',
      imei: '111111111111111',
      supplierPhone: '+998 90 000 13 00',
    }, 'iPhone 13')).toBe(false)
  })

  it.each(['%', '_', '\\'])('treats SQL wildcard-looking query %j literally', (query) => {
    expect(matchesDeviceSearch({
      model: `Literal ${query} marker`,
      imei: '111111111111111',
    }, query)).toBe(true)
    expect(matchesDeviceSearch({
      model: 'Literal marker without wildcard glyph',
      imei: '111111111111111',
    }, query)).toBe(false)
  })
})

describe('contiguous nasiya search semantics', () => {
  const base = {
    customerName: 'Alisher Karimov',
    customerPhone: '+998 90 100 00 00',
    deviceModel: 'Unrelated model',
    imei: '111111111111111',
  }

  it('matches 2446 in each supported identifier/text field', () => {
    expect(matchesNasiyaSearch({ ...base, customerPhone: '+998 90 124 46 78' }, '2446')).toBe(true)
    expect(matchesNasiyaSearch({
      ...base,
      additionalPhones: ['+998 95 002 44 67'],
    } as Parameters<typeof matchesNasiyaSearch>[0], '2446')).toBe(true)
    expect(matchesNasiyaSearch({ ...base, imei: '35-912-2446-789012' }, '2446')).toBe(true)
    expect(matchesNasiyaSearch({
      ...base,
      imeis: [{ value: '86 001 2446 789012' }],
    } as Parameters<typeof matchesNasiyaSearch>[0], '2446')).toBe(true)
    expect(matchesNasiyaSearch({ ...base, deviceModel: 'Model 2446' }, '2446')).toBe(true)
    expect(matchesNasiyaSearch({ ...base, note: 'Shartnoma 2446' }, '2446')).toBe(true)
  })

  it.each(['2xx4xx4xx6', '2464'])('rejects the non-contiguous decoy %s', (value) => {
    expect(matchesNasiyaSearch({
      ...base,
      customerName: value,
      customerPhone: '+998 90 100 00 00',
      deviceModel: value,
      imei: value,
      note: value,
    }, '2446')).toBe(false)
  })

  it('does not assemble 2446 from fragments in different fields', () => {
    expect(matchesNasiyaSearch({
      ...base,
      customerName: '24',
      deviceModel: '46',
    }, '2446')).toBe(false)
  })

  it('does not activate phone fallback for iPhone 13', () => {
    expect(matchesNasiyaSearch({
      ...base,
      customerPhone: '+998 90 000 13 00',
      deviceModel: 'Samsung S24',
    }, 'iPhone 13')).toBe(false)
  })
})
