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
