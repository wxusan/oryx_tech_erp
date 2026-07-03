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

/** `Sentabr 2026` — month name + year. */
export function uzMonthYear(value: Date | string | number | null | undefined, fallback = '-') {
  const date = toDate(value)
  if (!date) return fallback
  return `${UZ_MONTHS[date.getMonth()]} ${date.getFullYear()}`
}

/** `Sentabr` — month name only. */
export function uzMonth(value: Date | string | number | null | undefined, fallback = '-') {
  const date = toDate(value)
  if (!date) return fallback
  return UZ_MONTHS[date.getMonth()]
}

/** `30.09.2026` — unambiguous numeric day.month.year. */
export function uzDate(value: Date | string | number | null | undefined, fallback = '-') {
  const date = toDate(value)
  if (!date) return fallback
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`
}

/** `30.09.2026, 14:30` — date with time. */
export function uzDateTime(value: Date | string | number | null | undefined, fallback = '-') {
  const date = toDate(value)
  if (!date) return fallback
  return `${uzDate(date)}, ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** `30 Sentabr 2026` — long, human day + month name + year. */
export function uzLongDate(value: Date | string | number | null | undefined, fallback = '-') {
  const date = toDate(value)
  if (!date) return fallback
  return `${date.getDate()} ${UZ_MONTHS[date.getMonth()]} ${date.getFullYear()}`
}
