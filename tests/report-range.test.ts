import { describe, expect, it } from 'vitest'
import { monthKeysInRange, resolveReportRange, shiftMonthKey } from '@/lib/report-range'

describe('report range contract', () => {
  it('shifts calendar months across year boundaries without local timezone drift', () => {
    expect(shiftMonthKey('2026-01', -1)).toBe('2025-12')
    expect(shiftMonthKey('2026-12', 1)).toBe('2027-01')
  })

  it('builds exact trailing 3/6/12 inclusive calendar ranges', () => {
    expect(resolveReportRange({ preset: 'trailing3', defaultEndMonth: '2026-07' }).monthKeys)
      .toEqual(['2026-05', '2026-06', '2026-07'])
    expect(resolveReportRange({ preset: 'trailing6', defaultEndMonth: '2026-02' }).monthKeys)
      .toEqual(['2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02'])
    expect(resolveReportRange({ preset: 'trailing12', defaultEndMonth: '2026-07' }).monthKeys).toHaveLength(12)
  })

  it('keeps single-month and custom URL contracts explicit', () => {
    expect(resolveReportRange({ preset: 'single', month: '2026-04', defaultEndMonth: '2026-07' }))
      .toMatchObject({ startMonth: '2026-04', endMonth: '2026-04', monthKeys: ['2026-04'] })
    expect(resolveReportRange({
      preset: 'custom',
      startMonth: '2025-12',
      endMonth: '2026-02',
      defaultEndMonth: '2026-07',
    }).monthKeys).toEqual(['2025-12', '2026-01', '2026-02'])
  })

  it('rejects inverted, invalid, and unbounded custom ranges', () => {
    expect(() => monthKeysInRange('2026-08', '2026-07')).toThrow(/Boshlanish/)
    expect(() => resolveReportRange({
      preset: 'custom',
      startMonth: '2026-00',
      endMonth: '2026-02',
      defaultEndMonth: '2026-07',
    })).toThrow(/talab qilinadi/)
    expect(() => monthKeysInRange('2020-01', '2024-01')).toThrow(/36/)
  })

  it('uses exact Tashkent month boundaries', () => {
    const range = resolveReportRange({ preset: 'single', month: '2026-07', defaultEndMonth: '2026-07' })
    expect(range.start.toISOString()).toBe('2026-06-30T19:00:00.000Z')
    expect(range.end.toISOString()).toBe('2026-07-31T19:00:00.000Z')
  })
})
