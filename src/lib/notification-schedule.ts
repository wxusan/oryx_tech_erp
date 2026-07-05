/**
 * Deterministic send-time jitter for PLANNED reminder notifications.
 *
 * Goal: scheduled reminders (nasiya/sale due-today + overdue) should land around
 * 11:00 Asia/Tashkent but NOT all at the same second, to avoid a Telegram/API
 * burst. Each notification gets a stable offset inside an 11:00–11:30 window so
 * repeated cron runs never move it (idempotent) and never duplicate it.
 *
 * Pure module: no DB, no side effects — safe to unit-test in the node env.
 */

import { tashkentDayRange } from '@/lib/timezone'

// Window: 11:00–11:30 Asia/Tashkent. Tashkent is UTC+5 year-round (no DST).
export const REMINDER_WINDOW_START_HOUR = 11
export const REMINDER_WINDOW_MINUTES = 30

const HOUR_MS = 60 * 60 * 1000
const MINUTE_MS = 60 * 1000

/** Stable 32-bit FNV-1a hash so the same key maps to the same minute forever. */
function hashKey(key: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/**
 * Deterministic minute offset (0 .. REMINDER_WINDOW_MINUTES-1) for a reminder.
 * Pass a stable key — the notification dedupeKey is ideal, since it already
 * encodes shop/schedule/admin/day, so the same reminder keeps the same slot.
 */
export function jitterMinutes(key: string): number {
  return hashKey(key) % REMINDER_WINDOW_MINUTES
}

/**
 * The UTC Date at which a planned reminder should be sent: 11:00 on the current
 * Asia/Tashkent day + the key's stable jitter offset. Because it is derived from
 * the Tashkent day (not the server's local midnight), it never drifts across the
 * UTC day boundary.
 */
export function scheduledReminderSendAt(key: string, now: Date = new Date()): Date {
  const { start } = tashkentDayRange(now) // Tashkent 00:00 expressed in UTC
  const base = start.getTime() + REMINDER_WINDOW_START_HOUR * HOUR_MS
  return new Date(base + jitterMinutes(key) * MINUTE_MS)
}
