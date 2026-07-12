import { describe, expect, it } from 'vitest'
import { deviceConditionLabel, formatDeviceStorage, normalizeImei, parseDeviceStorage, validateImeiPair } from '@/lib/device-specs'

describe('device specs', () => {
  it.each([
    ['256GB', 256, 'GB'],
    ['256 GB', 256, 'GB'],
    ['1TB', 1, 'TB'],
    ['1 TB', 1, 'TB'],
  ] as const)('parses %s', (raw, amount, unit) => {
    expect(parseDeviceStorage(raw)).toMatchObject({ amount, unit, display: `${amount}${unit}` })
  })

  it('does not infer a legacy bare amount without an explicit unit', () => {
    expect(parseDeviceStorage('256')).toBeNull()
    expect(parseDeviceStorage('256', 'GB')?.display).toBe('256GB')
    expect(parseDeviceStorage('1TBTB')).toBeNull()
  })

  it('formats structured storage once and preserves a legacy fallback', () => {
    expect(formatDeviceStorage({ storageAmount: 1, storageUnit: 'TB', storage: '1TBGB' })).toBe('1TB')
    expect(formatDeviceStorage({ storage: 'legacy' })).toBe('legacy')
  })

  it('uses the exact requested condition labels', () => {
    expect(deviceConditionLabel('NEW')).toBe('Yangi')
    expect(deviceConditionLabel('USED')).toBe('B/U')
    expect(deviceConditionLabel(null)).toBe('Belgilanmagan')
  })

  it('normalizes two valid IMEIs and rejects cross-slot duplicates', () => {
    expect(normalizeImei('35123 456-0012345')).toBe('351234560012345')
    expect(validateImeiPair('351234560012345', '351234560012345')).toMatchObject({ ok: false })
    expect(validateImeiPair('351234560012345', '351234560012346')).toEqual({ ok: true, primaryImei: '351234560012345', secondaryImei: '351234560012346' })
  })
})
