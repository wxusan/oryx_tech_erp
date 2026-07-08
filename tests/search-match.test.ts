import { describe, it, expect } from 'vitest'
import { matchesDeviceSearch, matchesNasiyaSearch } from '@/lib/search-match'

describe('matchesDeviceSearch', () => {
  const device = {
    model: 'iPhone 13 Pro',
    imei: '356789012345678',
    color: 'Qora',
    storage: '256GB',
    note: "Ekran ustida chizig'i bor",
    supplierName: 'Aziz Supplier',
    supplierPhone: '+998901234567',
  }

  it('matches by model, case-insensitively', () => {
    expect(matchesDeviceSearch(device, 'iphone')).toBe(true)
    expect(matchesDeviceSearch(device, 'IPHONE 13')).toBe(true)
  })

  it('matches full and partial IMEI', () => {
    expect(matchesDeviceSearch(device, '356789012345678')).toBe(true)
    expect(matchesDeviceSearch(device, '789012')).toBe(true)
  })

  it('matches color, storage, note, and supplier name/phone', () => {
    expect(matchesDeviceSearch(device, 'qora')).toBe(true)
    expect(matchesDeviceSearch(device, '256')).toBe(true)
    expect(matchesDeviceSearch(device, 'chizig')).toBe(true)
    expect(matchesDeviceSearch(device, 'Aziz')).toBe(true)
    expect(matchesDeviceSearch(device, '901234567')).toBe(true)
  })

  it('empty query matches everything', () => {
    expect(matchesDeviceSearch(device, '')).toBe(true)
    expect(matchesDeviceSearch(device, '   ')).toBe(true)
  })

  it('no match for unrelated text', () => {
    expect(matchesDeviceSearch(device, 'Samsung')).toBe(false)
  })
})

describe('matchesNasiyaSearch', () => {
  const nasiya = {
    customerName: 'Alisher Karimov',
    customerPhone: '+998 90 123 45 67',
    deviceModel: 'Redmi Note 12',
    imei: '861234567890123',
    note: 'VIP mijoz',
    statusLabel: "Muddati o'tgan",
  }

  it('matches customer name case-insensitively', () => {
    expect(matchesNasiyaSearch(nasiya, 'alisher')).toBe(true)
  })

  it('matches phone with spaces exactly as typed', () => {
    expect(matchesNasiyaSearch(nasiya, '90 123 45 67')).toBe(true)
  })

  it('matches phone regardless of spacing/plus via normalized digits', () => {
    expect(matchesNasiyaSearch(nasiya, '998901234567')).toBe(true)
    expect(matchesNasiyaSearch(nasiya, '+998901234567')).toBe(true)
  })

  it('matches device model and full/partial IMEI', () => {
    expect(matchesNasiyaSearch(nasiya, 'redmi')).toBe(true)
    expect(matchesNasiyaSearch(nasiya, '234567890')).toBe(true)
  })

  it('matches note and status label', () => {
    expect(matchesNasiyaSearch(nasiya, 'VIP')).toBe(true)
    expect(matchesNasiyaSearch(nasiya, "muddati")).toBe(true)
  })

  it('no match for unrelated text', () => {
    expect(matchesNasiyaSearch(nasiya, 'Tashkent')).toBe(false)
  })
})
