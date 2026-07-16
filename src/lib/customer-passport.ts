import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto'
import { isValidPassportIdentifier, normalizePassportIdentifier } from '@/lib/passport-identifier-format'

export { isValidPassportIdentifier, normalizePassportIdentifier } from '@/lib/passport-identifier-format'

const ENCRYPTION_VERSION = 'v1'
const MIN_SECRET_LENGTH = 32

export class CustomerPassportConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CustomerPassportConfigurationError'
  }
}

const PASSPORT_IDENTIFIER_STORED = /^[A-Z]{2}\d{7}$/

function isValidStoredPassportIdentifier(value: string): boolean {
  return PASSPORT_IDENTIFIER_STORED.test(value)
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
  if (!isValidStoredPassportIdentifier(normalized)) throw new Error("Pasport seriya/raqami AA 1234567 formatida bo'lishi kerak")
  return createHmac('sha256', searchSecret(secret)).update(normalized).digest('base64url')
}

/** AES-256-GCM envelope: version.iv.authTag.ciphertext (all base64url). */
export function encryptPassportIdentifier(value: string, secret?: string): string {
  const normalized = normalizePassportIdentifier(value)
  if (!isValidStoredPassportIdentifier(normalized)) throw new Error("Pasport seriya/raqami AA 1234567 formatida bo'lishi kerak")

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
  if (!isValidStoredPassportIdentifier(plaintext)) throw new Error("Saqlangan pasport ma'lumoti noto'g'ri")
  return plaintext
}

export function passportIdentifierStorage(value: string, secrets?: { encryption?: string; search?: string }) {
  if (!isValidPassportIdentifier(value)) throw new Error("Pasport seriya/raqami AA 1234567 formatida bo'lishi kerak")
  const normalized = normalizePassportIdentifier(value)
  if (!isValidStoredPassportIdentifier(normalized)) throw new Error("Pasport seriya/raqami AA 1234567 formatida bo'lishi kerak")
  return {
    passportIdentifierCiphertext: encryptPassportIdentifier(normalized, secrets?.encryption),
    passportIdentifierHash: hashPassportIdentifier(normalized, secrets?.search),
    passportIdentifierLast4: normalized.slice(-4),
    passportIdentifierKeyVersion: 1,
  }
}
