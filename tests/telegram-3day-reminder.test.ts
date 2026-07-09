import { describe, it, expect } from 'vitest'
import { tashkentDaysUntil, matchesEarlyReminderDay } from '@/lib/timezone'

/**
 * Item 9 — Telegram reminder N days before due date (the ticket's "3-day
 * reminder"). The underlying mechanism already existed (per-deal
 * `earlyReminderEnabled`/`earlyReminderDays`, used identically for Nasiya
 * schedules, Sale, and SupplierPayable — see
 * src/app/api/cron/reminders/route.ts) but its day-count arithmetic was
 * duplicated inline three times with no direct unit test. Extracted into
 * `tashkentDaysUntil`/`matchesEarlyReminderDay` (src/lib/timezone.ts) so the
 * exact "3 days before, never 2 or 4" requirement is provable without a
 * live database.
 */
describe('tashkentDaysUntil', () => {
  it('is 0 for a due date that is today', () => {
    expect(tashkentDaysUntil(new Date('2026-07-15T09:00:00.000Z'), new Date('2026-07-15T02:00:00.000Z'))).toBe(0)
  })

  it('is exactly 3 for a due date 3 Tashkent-calendar-days ahead, regardless of time-of-day', () => {
    // "today" late in the Tashkent day (23:00 Tashkent = 18:00 UTC), due
    // date early in ITS Tashkent day (00:30 Tashkent = 2026-07-17T19:30Z
    // previous UTC day) — still exactly 3 calendar days apart in Tashkent.
    const today = new Date('2026-07-15T18:00:00.000Z') // 2026-07-15 23:00 Tashkent
    const due = new Date('2026-07-17T19:30:00.000Z') // 2026-07-18 00:30 Tashkent
    expect(tashkentDaysUntil(due, today)).toBe(3)
  })

  it('is negative for a due date in the past (overdue)', () => {
    expect(tashkentDaysUntil(new Date('2026-07-10T00:00:00.000Z'), new Date('2026-07-15T00:00:00.000Z'))).toBe(-5)
  })
})

describe('matchesEarlyReminderDay (item 9 — exactly 3 days before, never 2 or 4)', () => {
  it('matches when daysUntil equals earlyReminderDays exactly', () => {
    expect(matchesEarlyReminderDay(3, 3)).toBe(true)
  })

  it('does NOT match 4 days before when earlyReminderDays is 3', () => {
    expect(matchesEarlyReminderDay(4, 3)).toBe(false)
  })

  it('does NOT match 2 days before when earlyReminderDays is 3', () => {
    expect(matchesEarlyReminderDay(2, 3)).toBe(false)
  })

  it('never matches when earlyReminderDays is null (reminder not configured)', () => {
    expect(matchesEarlyReminderDay(3, null)).toBe(false)
  })

  it('never matches a zero or negative earlyReminderDays (would collide with due-day/overdue reminders)', () => {
    expect(matchesEarlyReminderDay(0, 0)).toBe(false)
    expect(matchesEarlyReminderDay(-1, -1)).toBe(false)
  })

  it('matches any configured lead time, not just 3 (per-deal configurable, per the existing UI)', () => {
    expect(matchesEarlyReminderDay(7, 7)).toBe(true)
    expect(matchesEarlyReminderDay(1, 1)).toBe(true)
  })
})
