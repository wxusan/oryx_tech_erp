import { describe, it, expect } from 'vitest'
import { tashkentMonthRange, tashkentDayRange } from '@/lib/timezone'

// Asia/Tashkent is UTC+5 (no DST). These tests prove month/day boundaries are
// computed in Tashkent time, not the server's local/UTC time (req 8).

describe('tashkentMonthRange (req 8)', () => {
  it('a UTC timestamp that is already next-month in Tashkent lands in the Tashkent month', () => {
    // 2026-06-30 20:00 UTC === 2026-07-01 01:00 Tashkent -> July, not June.
    const now = new Date('2026-06-30T20:00:00Z')
    const { start, end, monthKey } = tashkentMonthRange(now)
    expect(monthKey).toBe('2026-07')
    // July 1 00:00 Tashkent === June 30 19:00 UTC
    expect(start.toISOString()).toBe('2026-06-30T19:00:00.000Z')
    // Aug 1 00:00 Tashkent === July 31 19:00 UTC
    expect(end.toISOString()).toBe('2026-07-31T19:00:00.000Z')
  })

  it('mid-month resolves to that month with a 1-month-wide window', () => {
    const { start, end, monthKey } = tashkentMonthRange(new Date('2026-03-15T08:00:00Z'))
    expect(monthKey).toBe('2026-03')
    expect(start.toISOString()).toBe('2026-02-28T19:00:00.000Z') // Mar 1 Tashkent
    expect(end.toISOString()).toBe('2026-03-31T19:00:00.000Z') // Apr 1 Tashkent
  })

  it('rolls the year over at December', () => {
    const { monthKey, end } = tashkentMonthRange(new Date('2026-12-10T00:00:00Z'))
    expect(monthKey).toBe('2026-12')
    expect(end.toISOString()).toBe('2026-12-31T19:00:00.000Z') // Jan 1 2027 Tashkent
  })
})

describe('tashkentDayRange', () => {
  it('produces a 24h window and a stable Tashkent day key', () => {
    const { start, end, dayKey } = tashkentDayRange(new Date('2026-06-30T20:00:00Z'))
    expect(dayKey).toBe('2026-07-01') // already next day in Tashkent
    expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000)
    expect(start.toISOString()).toBe('2026-06-30T19:00:00.000Z')
  })

  it('two instants within the same Tashkent day share the same dayKey (dedupe basis)', () => {
    const a = tashkentDayRange(new Date('2026-07-01T00:00:00Z')).dayKey // 05:00 Tashkent
    const b = tashkentDayRange(new Date('2026-07-01T18:00:00Z')).dayKey // 23:00 Tashkent
    expect(a).toBe(b)
  })
})
