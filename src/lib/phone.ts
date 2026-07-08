export function normalizePhone(phone: string) {
  const digits = phone.replace(/\D/g, '')
  return digits || null
}

// User-facing message for an invalid phone. Kept here so the client form and any
// future server message stay in sync.
export const PHONE_ERROR = "Telefon raqam noto'g'ri. Masalan: +998 90 123 45 67"

// Client-side phone validity, kept consistent with the server `phoneSchema`
// (min 9 / max 20 chars). We validate on the normalized digit count so garbage
// like "abc" or "123" is rejected up front, while every value this accepts also
// satisfies the server rule (digits ⇒ length ≥ 9, and ≤ 20 chars). Accepts the
// shop's real formats: "+998 90 000 00 00", "+998900000000", "998900000000",
// and local "900000000".
export function isValidPhone(phone: string): boolean {
  const trimmed = phone.trim()
  if (trimmed.length < 9 || trimmed.length > 20) return false
  const digits = normalizePhone(trimmed)
  return !!digits && digits.length >= 9 && digits.length <= 15
}

const UZ_COUNTRY_CODE = '998'
// A local Uzbek mobile number is 9 digits (e.g. "90 123 45 67"); with the
// country code prepended that's 12 digits total.
const MAX_PHONE_DIGITS = 12

/**
 * Auto-prefixes a phone input with the Uzbekistan country code as the user
 * types or pastes, so "90 123 45 67", "998901234567", and "+998901234567"
 * all converge on the same digit string instead of requiring the user to
 * type "998" themselves. Returns a `+`-prefixed display string (or `''` for
 * an empty field) — never mutates a value that already starts with the
 * country code, and collapses an accidental double "998998..." prefix
 * (e.g. pasting "+998..." into a field that already had "998..." typed).
 */
export function applyPhonePrefix(raw: string): string {
  let digits = raw.replace(/\D/g, '')
  if (!digits) return ''

  while (digits.startsWith(UZ_COUNTRY_CODE + UZ_COUNTRY_CODE)) {
    digits = digits.slice(UZ_COUNTRY_CODE.length)
  }

  if (!digits.startsWith(UZ_COUNTRY_CODE)) {
    digits = UZ_COUNTRY_CODE + digits
  }

  digits = digits.slice(0, MAX_PHONE_DIGITS)
  return `+${digits}`
}

/**
 * Normalizes a customer's additional-phone-numbers list for storage: drops
 * blanks and invalid entries, normalizes to digits-only (matching
 * `normalizePhone`'s convention so search can match them the same way as the
 * primary phone), de-duplicates, and excludes any entry that's actually the
 * same number as the primary phone (no point storing it twice).
 */
export function normalizeAdditionalPhones(phones: string[], primaryPhone?: string | null): string[] {
  const primaryDigits = primaryPhone ? normalizePhone(primaryPhone) : null
  const seen = new Set<string>()
  const result: string[] = []

  for (const raw of phones) {
    if (!isValidPhone(raw)) continue
    const digits = normalizePhone(raw)
    if (!digits) continue
    if (digits === primaryDigits) continue
    if (seen.has(digits)) continue
    seen.add(digits)
    result.push(digits)
  }

  return result
}
