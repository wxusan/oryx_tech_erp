export function normalizePhone(phone: string) {
  const digits = phone.replace(/\D/g, '')
  return digits || null
}
