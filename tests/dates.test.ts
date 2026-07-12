import { describe, it, expect } from 'vitest'
import { uzMonthYear, uzMonth, uzDate, uzDateTime, uzLongDate, UZ_MONTHS } from '../src/lib/dates'

// The runtime Intl data lacks Uzbek month names, so toLocaleDateString('uz-UZ',
// { month: 'long' }) renders broken "2026 M09". These helpers must produce clean
// hardcoded Uzbek month names and stable numeric dates on every environment.

describe('uz date formatters', () => {
  // Absolute instant corresponding to 14:05 in Asia/Tashkent. The formatter
  // must not depend on the test runner's host timezone (CI runs in UTC).
  const d = new Date('2026-09-30T09:05:00.000Z')

  it('uzMonthYear gives a real Uzbek month name, never "M09"', () => {
    expect(uzMonthYear(d)).toBe('Sentabr 2026')
    expect(uzMonthYear(d)).not.toMatch(/M\d/)
  })

  it('uzMonth gives just the month name', () => {
    expect(uzMonth(d)).toBe('Sentabr')
  })

  it('uzDate is unambiguous zero-padded day.month.year', () => {
    expect(uzDate(d)).toBe('30.09.2026')
    expect(uzDate(new Date('2026-01-05T00:00:00.000Z'))).toBe('05.01.2026')
  })

  it('uzDateTime appends zero-padded time', () => {
    expect(uzDateTime(d)).toBe('30.09.2026, 14:05')
  })

  it('uzLongDate gives human day + month name + year', () => {
    expect(uzLongDate(d)).toBe('30 Sentabr 2026')
  })

  it('accepts ISO strings', () => {
    expect(uzMonthYear('2026-09-30T00:00:00')).toBe('Sentabr 2026')
  })

  it('returns the fallback for null / invalid input instead of throwing', () => {
    expect(uzMonthYear(null)).toBe('-')
    expect(uzDate(undefined)).toBe('-')
    expect(uzDate('not-a-date')).toBe('-')
    expect(uzMonthYear(null, '—')).toBe('—')
  })

  it('has exactly 12 Uzbek month names', () => {
    expect(UZ_MONTHS).toHaveLength(12)
    expect(UZ_MONTHS[0]).toBe('Yanvar')
    expect(UZ_MONTHS[11]).toBe('Dekabr')
  })
})
