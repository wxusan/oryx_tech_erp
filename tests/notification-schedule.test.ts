import { describe, it, expect } from 'vitest'
import {
  jitterMinutes,
  scheduledReminderSendAt,
  REMINDER_WINDOW_MINUTES,
  REMINDER_WINDOW_START_HOUR,
} from '@/lib/notification-schedule'
import { tashkentDayRange } from '@/lib/timezone'

// Tashkent is UTC+5 year-round; 11:00 Tashkent = 06:00 UTC.
function tashkentHourMinute(d: Date): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Tashkent',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  return { hour: get('hour'), minute: get('minute') }
}

describe('reminder jitter (11:00–11:30 Asia/Tashkent)', () => {
  it('is deterministic — same key always maps to the same minute', () => {
    const key = 'REMINDER:2026-07-05:12345:sched_abc'
    expect(jitterMinutes(key)).toBe(jitterMinutes(key))
    expect(scheduledReminderSendAt(key).getTime()).toBe(scheduledReminderSendAt(key).getTime())
  })

  it('keeps every offset inside the 30-minute window', () => {
    for (let i = 0; i < 500; i++) {
      const m = jitterMinutes(`OVERDUE:2026-07-05:admin:${i}`)
      expect(m).toBeGreaterThanOrEqual(0)
      expect(m).toBeLessThan(REMINDER_WINDOW_MINUTES)
    }
  })

  it('targets 11:00 Asia/Tashkent + jitter, never outside 11:00–11:29', () => {
    const now = new Date('2026-07-05T09:00:00.000Z') // 14:00 Tashkent, same day
    for (const key of ['a', 'b', 'c', 'REMINDER:x', 'SALE_OVERDUE:y:z']) {
      const sendAt = scheduledReminderSendAt(key, now)
      const { hour, minute } = tashkentHourMinute(sendAt)
      expect(hour).toBe(REMINDER_WINDOW_START_HOUR) // always the 11 o'clock hour
      expect(minute).toBeGreaterThanOrEqual(0)
      expect(minute).toBeLessThan(REMINDER_WINDOW_MINUTES)
    }
  })

  it('spreads a batch of reminders across multiple minutes (not all at :00)', () => {
    const minutes = new Set<number>()
    for (let i = 0; i < 60; i++) minutes.add(jitterMinutes(`sched-${i}`))
    // With 60 distinct keys over a 30-slot window we expect broad coverage.
    expect(minutes.size).toBeGreaterThan(10)
  })

  it('anchors to the Tashkent day even near the UTC midnight boundary', () => {
    // 23:30 UTC on Jul 5 is already 04:30 Tashkent on Jul 6 → must schedule for
    // Jul 6 11:00 Tashkent, not Jul 5.
    const nearBoundary = new Date('2026-07-05T23:30:00.000Z')
    const sendAt = scheduledReminderSendAt('key', nearBoundary)
    const { start } = tashkentDayRange(nearBoundary)
    // sendAt is on the same Tashkent day as `start` (Jul 6), 11:00 + jitter.
    expect(sendAt.getTime()).toBeGreaterThanOrEqual(start.getTime() + 11 * 3600_000)
    expect(sendAt.getTime()).toBeLessThan(start.getTime() + 12 * 3600_000)
  })
})
