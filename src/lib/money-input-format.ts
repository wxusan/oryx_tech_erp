/**
 * Client-side money INPUT formatting helpers.
 *
 * These only affect how a money value is TYPED/DISPLAYED — spaces as thousand
 * separators, a single optional decimal dot. The value kept in form state and
 * submitted is always a clean, space-free numeric string (or parsed number), so
 * server-side accounting / currency conversion is untouched.
 *
 * UZS is normally whole; USD may have decimals. Decimal typing is preserved for
 * both; the server rounds UZS as before.
 */

import type { CurrencyCode } from '@/lib/currency'

/**
 * Strip everything that isn't a digit or a decimal dot, and collapse multiple
 * dots down to the first one. Returns a space-free string like "1200" or "1200.5".
 */
export function cleanMoneyInput(value: string): string {
  if (value == null) return ''
  let cleaned = String(value).replace(/[^\d.]/g, '')
  const firstDot = cleaned.indexOf('.')
  if (firstDot !== -1) {
    // Keep the first dot, drop any subsequent dots.
    cleaned = cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '')
  }
  return cleaned
}

/**
 * Format a (possibly already formatted) money string for display: group the
 * integer part with single spaces every 3 digits and preserve the decimal part
 * exactly as typed (including a trailing dot while the user is mid-entry).
 *
 *   formatMoneyInput("1000")      => "1 000"
 *   formatMoneyInput("1000000")   => "1 000 000"
 *   formatMoneyInput("1200.50")   => "1 200.50"
 *   formatMoneyInput("1 200 000") => "1 200 000"
 */
export function formatMoneyInput(value: string): string {
  const cleaned = cleanMoneyInput(value)
  if (cleaned === '') return ''

  const dotIndex = cleaned.indexOf('.')
  const hasDot = dotIndex !== -1
  const intPart = hasDot ? cleaned.slice(0, dotIndex) : cleaned
  const decPart = hasDot ? cleaned.slice(dotIndex + 1) : ''

  const groupedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')

  return hasDot ? `${groupedInt}.${decPart}` : groupedInt
}

/**
 * Parse a typed/formatted money string into a number. Spaces and stray
 * characters are removed first. Returns NaN for empty / dot-only input so callers
 * can treat it as "not a valid positive amount".
 *
 *   parseMoneyInput("1 200 000") => 1200000
 *   parseMoneyInput("1 200.50")  => 1200.5
 */
export function parseMoneyInput(value: string): number {
  const cleaned = cleanMoneyInput(value)
  if (cleaned === '' || cleaned === '.') return NaN
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : NaN
}

/**
 * Convert a stored numeric amount into the clean input string used by the money
 * inputs (no spaces). UZS is rounded to a whole number; USD keeps up to 2
 * decimals (trailing zeros trimmed).
 */
export function moneyNumberToInputValue(value: number, currency?: CurrencyCode): string {
  if (!Number.isFinite(value)) return ''
  if (currency === 'USD') {
    return String(Math.round(value * 100) / 100)
  }
  return String(Math.round(value))
}
