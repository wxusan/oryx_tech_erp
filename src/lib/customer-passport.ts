import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto'

const ENCRYPTION_VERSION = 'v1'
const MIN_SECRET_LENGTH = 32

export class CustomerPassportConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CustomerPassportConfigurationError'
  }
}

export function normalizePassportIdentifier(value: string): string {
  return value.normalize('NFKC').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export function isValidPassportIdentifier(value: string): boolean {
  const normalized = normalizePassportIdentifier(value)
  return normalized.length >= 5 && normalized.length <= 32 && /[A-Z]/.test(normalized) && /\d/.test(normalized)
}

export function maskPassportIdentifier(value: string): string {
  const normalized = normalizePassportIdentifier(value)
  if (!normalized) return ''
  const visible = normalized.slice(-4)
  return `${'•'.repeat(Math.max(2, normalized.length - visible.length))}${visible}`
}

function requireSecret(value: string | undefined, name: string): string {
  if (!value || value.length < MIN_SECRET_LENGTH) {
    throw new CustomerPassportConfigurationError(`${name} kamida ${MIN_SECRET_LENGTH} ta belgidan iborat bo'lishi kerak`)
  }
  return value
}

function encryptionKey(secret?: string): Buffer {
  return createHash('sha256')
    .update(requireSecret(secret ?? process.env.CUSTOMER_PII_ENCRYPTION_KEY, 'CUSTOMER_PII_ENCRYPTION_KEY'))
    .digest()
}

function searchSecret(secret?: string): string {
  return requireSecret(secret ?? process.env.CUSTOMER_PII_SEARCH_KEY, 'CUSTOMER_PII_SEARCH_KEY')
}

/**
 * Secret-scoped exact-search token. The normalized identifier never enters a
 * SQL LIKE predicate, log line, cache key, or browser response.
 */
export function hashPassportIdentifier(value: string, secret?: string): string {
  const normalized = normalizePassportIdentifier(value)
  if (!isValidPassportIdentifier(normalized)) throw new Error("Pasport seriya/raqami noto'g'ri")
  return createHmac('sha256', searchSecret(secret)).update(normalized).digest('base64url')
}

/** AES-256-GCM envelope: version.iv.authTag.ciphertext (all base64url). */
export function encryptPassportIdentifier(value: string, secret?: string): string {
  const normalized = normalizePassportIdentifier(value)
  if (!isValidPassportIdentifier(normalized)) throw new Error("Pasport seriya/raqami noto'g'ri")

  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(secret), iv)
  const ciphertext = Buffer.concat([cipher.update(normalized, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return [ENCRYPTION_VERSION, iv.toString('base64url'), authTag.toString('base64url'), ciphertext.toString('base64url')].join('.')
}

export function decryptPassportIdentifier(envelope: string, secret?: string): string {
  const [version, ivValue, tagValue, ciphertextValue, extra] = envelope.split('.')
  if (version !== ENCRYPTION_VERSION || !ivValue || !tagValue || !ciphertextValue || extra !== undefined) {
    throw new Error('Pasport ma\'lumoti formati noto\'g\'ri')
  }

  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(secret), Buffer.from(ivValue, 'base64url'))
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'))
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, 'base64url')),
    decipher.final(),
  ]).toString('utf8')
  if (!isValidPassportIdentifier(plaintext)) throw new Error("Saqlangan pasport ma'lumoti noto'g'ri")
  return plaintext
}

export function passportIdentifierStorage(value: string, secrets?: { encryption?: string; search?: string }) {
  const normalized = normalizePassportIdentifier(value)
  if (!isValidPassportIdentifier(normalized)) throw new Error("Pasport seriya/raqami noto'g'ri")
  return {
    passportIdentifierCiphertext: encryptPassportIdentifier(normalized, secrets?.encryption),
    passportIdentifierHash: hashPassportIdentifier(normalized, secrets?.search),
    passportIdentifierLast4: normalized.slice(-4),
    passportIdentifierKeyVersion: 1,
  }
}
