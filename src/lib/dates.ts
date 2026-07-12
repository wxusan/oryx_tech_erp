/**
 * Uzbek date / month formatting.
 *
 * The runtime `Intl` data does not ship proper Uzbek (`uz-UZ`) month names, so
 * `Date.prototype.toLocaleDateString('uz-UZ', { month: 'long' })` renders broken
 * output like `2026 M09` instead of `Sentabr 2026`. These helpers use a hardcoded
 * Uzbek month table and locale-independent numeric formatting so dates read the
 * same on every server and browser. Client-safe (no `server-only`, no Node APIs).
 */

export const UZ_MONTHS = [
  'Yanvar',
  'Fevral',
  'Mart',
  'Aprel',
  'May',
  'Iyun',
  'Iyul',
  'Avgust',
  'Sentabr',
  'Oktabr',
  'Noyabr',
  'Dekabr',
] as const

function toDate(value: Date | string | number | null | undefined): Date | null {
  if (value == null) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function pad(value: number) {
  return String(value).padStart(2, '0')
}

function tashkentParts(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tashkent',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ''
  return { year: Number(value('year')), month: Number(value('month')), day: Number(value('day')), hour: Number(value('hour')), minute: Number(value('minute')) }
}

/** `Sentabr 2026` — month name + year. */
export function uzMonthYear(value: Date | string | number | null | undefined, fallback = '-') {
  const date = toDate(value)
  if (!date) return fallback
  const part = tashkentParts(date)
  return `${UZ_MONTHS[part.month - 1]} ${part.year}`
}

/** `Sentabr` — month name only. */
export function uzMonth(value: Date | string | number | null | undefined, fallback = '-') {
  const date = toDate(value)
  if (!date) return fallback
  return UZ_MONTHS[tashkentParts(date).month - 1]
}

/** `30.09.2026` — unambiguous numeric day.month.year. */
export function uzDate(value: Date | string | number | null | undefined, fallback = '-') {
  const date = toDate(value)
  if (!date) return fallback
  const part = tashkentParts(date)
  return `${pad(part.day)}.${pad(part.month)}.${part.year}`
}

/** `30.09.2026, 14:30` — date with time. */
export function uzDateTime(value: Date | string | number | null | undefined, fallback = '-') {
  const date = toDate(value)
  if (!date) return fallback
  const part = tashkentParts(date)
  return `${uzDate(date)}, ${pad(part.hour)}:${pad(part.minute)}`
}

/** `30 Sentabr 2026` — long, human day + month name + year. */
export function uzLongDate(value: Date | string | number | null | undefined, fallback = '-') {
  const date = toDate(value)
  if (!date) return fallback
  const part = tashkentParts(date)
  return `${part.day} ${UZ_MONTHS[part.month - 1]} ${part.year}`
}
