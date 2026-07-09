const TASHKENT_TIME_ZONE = 'Asia/Tashkent'
const TASHKENT_UTC_OFFSET_HOURS = 5

function tashkentParts(now: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TASHKENT_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? ''

  return {
    year: Number(part('year')),
    month: Number(part('month')),
    day: Number(part('day')),
    yearText: part('year'),
    monthText: part('month'),
    dayText: part('day'),
  }
}

function utcFromTashkentDate(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month - 1, day, -TASHKENT_UTC_OFFSET_HOURS, 0, 0, 0))
}

export function tashkentDayRange(now = new Date()) {
  const parts = tashkentParts(now)
  const start = utcFromTashkentDate(parts.year, parts.month, parts.day)
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + 1)

  return {
    start,
    end,
    dayKey: `${parts.yearText}-${parts.monthText}-${parts.dayText}`,
  }
}

/**
 * Today's calendar date in Asia/Tashkent as a `YYYY-MM-DD` string, suitable as
 * the default value of an `<input type="date">`. Never derived from server
 * local time or UTC directly (both can be off by a day from Tashkent).
 */
export function tashkentTodayInputValue(now = new Date()): string {
  return tashkentDayRange(now).dayKey
}

/**
 * Whole Tashkent-calendar-days between today and an effective due date —
 * the shared day-count math behind every "N days before due date" early
 * reminder (nasiya schedule / sale / supplier payable — see
 * src/app/api/cron/reminders/route.ts). Extracted so the "3 days before"
 * requirement (item 9 of docs/product-feature-fixes.md's follow-up) has a
 * directly unit-testable home instead of three copies of the same inline
 * arithmetic. Both `effectiveDueDate` and `today` are compared by their
 * Tashkent CALENDAR DAY, not raw millisecond difference, so a due date late
 * in the day and "now" early in the day still count as the same number of
 * whole days apart.
 */
export function tashkentDaysUntil(effectiveDueDate: Date, today: Date): number {
  return Math.round((tashkentDayRange(effectiveDueDate).start.getTime() - tashkentDayRange(today).start.getTime()) / 86_400_000)
}

/**
 * Whether an early reminder should fire today for a deal with the given
 * `earlyReminderDays` setting — exactly `daysUntil === earlyReminderDays`,
 * never "at or before" (that would re-fire every day up to the due date,
 * duplicating the due-day/overdue reminders). `null`/`0`/negative settings
 * never match (0 or negative would collide with the due-day/overdue
 * reminders, which are separate code paths).
 */
export function matchesEarlyReminderDay(daysUntil: number, earlyReminderDays: number | null): boolean {
  if (!earlyReminderDays || earlyReminderDays <= 0) return false
  return daysUntil === earlyReminderDays
}

export function tashkentMonthRange(now = new Date()) {
  const parts = tashkentParts(now)
  const start = utcFromTashkentDate(parts.year, parts.month, 1)
  const nextMonth = parts.month === 12 ? 1 : parts.month + 1
  const nextYear = parts.month === 12 ? parts.year + 1 : parts.year
  const end = utcFromTashkentDate(nextYear, nextMonth, 1)

  return {
    start,
    end,
    monthKey: `${parts.yearText}-${parts.monthText}`,
  }
}

/**
 * Item 8 — same Tashkent-calendar-correct month boundaries as
 * `tashkentMonthRange`, but from an explicit `YYYY-MM` key (a month picked in
 * the hisobot UI) instead of "now". Invalid keys fall back to the current
 * month rather than producing an invalid Date range.
 */
export function tashkentMonthRangeFromKey(monthKey: string | null | undefined, now = new Date()) {
  const match = monthKey?.match(/^(\d{4})-(\d{2})$/)
  if (!match) return tashkentMonthRange(now)
  const year = Number(match[1])
  const month = Number(match[2])
  if (month < 1 || month > 12) return tashkentMonthRange(now)
  const start = utcFromTashkentDate(year, month, 1)
  const nextMonth = month === 12 ? 1 : month + 1
  const nextYear = month === 12 ? year + 1 : year
  const end = utcFromTashkentDate(nextYear, nextMonth, 1)
  return { start, end, monthKey: `${match[1]}-${match[2]}` }
}

/** Last `count` months (including the current one) as `YYYY-MM` keys, newest first — for a month-selector dropdown. */
export function recentTashkentMonthKeys(count: number, now = new Date()): string[] {
  const parts = tashkentParts(now)
  const keys: string[] = []
  let year = parts.year
  let month = parts.month
  for (let i = 0; i < count; i++) {
    keys.push(`${year}-${String(month).padStart(2, '0')}`)
    month -= 1
    if (month < 1) {
      month = 12
      year -= 1
    }
  }
  return keys
}
