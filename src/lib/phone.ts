export function normalizePhone(phone: string) {
  const digits = phone.replace(/\D/g, '')
  if (!digits) return null
  if (digits.length === 9) return `998${digits}`
  if (digits.length === 10 && digits.startsWith('8')) return `998${digits.slice(1)}`
  if (digits.length === 12 && digits.startsWith(UZ_COUNTRY_CODE)) return digits
  return digits
}

// User-facing message for an invalid phone. Kept here so the client form and any
// future server message stay in sync.
export const PHONE_ERROR = "Telefon raqam noto'g'ri. Masalan: +998 90 123 45 67"

const UZ_COUNTRY_CODE = '998'
const UZ_LOCAL_PHONE_LENGTH = 9

function uzLocalDigits(raw: string, clamp = false) {
  let digits = raw.replace(/\D/g, '')
  if (!digits) return ''

  const explicitInternational = raw.trim().startsWith('+')
  while (digits.length > UZ_LOCAL_PHONE_LENGTH + UZ_COUNTRY_CODE.length && digits.startsWith(UZ_COUNTRY_CODE + UZ_COUNTRY_CODE)) {
    digits = digits.slice(UZ_COUNTRY_CODE.length)
  }
  if ((explicitInternational || digits.length > UZ_LOCAL_PHONE_LENGTH) && digits.startsWith(UZ_COUNTRY_CODE)) {
    digits = digits.slice(UZ_COUNTRY_CODE.length)
  }

  // Some users still begin a full local number with the legacy trunk prefix
  // "8". Only remove it once there are ten local digits, so valid prefixes
  // such as 88 remain editable while the number is incomplete.
  if (digits.length === UZ_LOCAL_PHONE_LENGTH + 1 && digits.startsWith('8')) {
    digits = digits.slice(1)
  }

  return clamp ? digits.slice(0, UZ_LOCAL_PHONE_LENGTH) : digits
}

/**
 * Converts a user edit or paste to the canonical value sent to APIs. The
 * display component formats this value separately, so form state and storage
 * never contain spaces or a duplicated country code.
 */
export function normalizeUzPhoneInput(raw: string): string {
  const local = uzLocalDigits(raw, true)
  return local ? `+${UZ_COUNTRY_CODE}${local}` : ''
}

/** Returns a canonical Uzbek phone only when it is complete and valid. */
export function normalizeUzPhone(raw: string): string | null {
  const local = uzLocalDigits(raw)
  return local.length === UZ_LOCAL_PHONE_LENGTH ? `+${UZ_COUNTRY_CODE}${local}` : null
}

/** Formats an in-progress controlled edit, including partial local digits. */
export function formatUzPhoneInputDisplay(raw: string | null | undefined): string {
  if (!raw) return ''
  const normalized = normalizeUzPhoneInput(raw)
  if (!normalized) return ''

  const local = normalized.slice(UZ_COUNTRY_CODE.length + 1)
  const groups = [local.slice(0, 2), local.slice(2, 5), local.slice(5, 7), local.slice(7, 9), local.slice(9)].filter(Boolean)
  return `+${UZ_COUNTRY_CODE}${groups.length ? ` ${groups.join(' ')}` : ''}`
}

/**
 * Formats a saved phone without hiding invalid historic digits. Invalid legacy
 * values are returned verbatim so operators can see and repair them instead of
 * seeing a valid-looking truncated number.
 */
export function formatUzPhoneDisplay(raw: string | null | undefined): string {
  if (!raw) return ''
  const normalized = normalizeUzPhone(raw)
  if (!normalized) return raw.trim()
  return formatUzPhoneInputDisplay(normalized)
}

// Client and server use the same exact Uzbek-number rule. Optional fields
// should test for empty input before calling this helper.
export function isValidPhone(phone: string): boolean {
  return normalizeUzPhone(phone) !== null
}

/**
 * Auto-prefixes a phone input with the Uzbekistan country code as the user
 * types or pastes, so "90 123 45 67", "998901234567", and "+998901234567"
 * all converge on the same canonical submitted value instead of requiring the
 * user to type "998" themselves. Returns `''` for an empty field, never
 * duplicates an existing country code, and collapses an accidental "998998..." prefix
 * (e.g. pasting "+998..." into a field that already had "998..." typed).
 */
export function applyPhonePrefix(raw: string): string {
  return normalizeUzPhoneInput(raw)
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
