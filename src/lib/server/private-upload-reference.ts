import 'server-only'

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

export type PrivateUploadKind = 'device' | 'passport'

interface PrivateUploadPayload {
  v: 1
  kind: PrivateUploadKind
  shopId: string
  key: string
  expiresAt: number
}

const TOKEN_VERSION = 'v1'
const DEFAULT_TTL_MS = 60 * 60 * 1000

function secretValue(explicit?: string) {
  const secret = explicit || process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET
  if (!secret || secret.length < 32) {
    throw new Error('AUTH_SECRET or NEXTAUTH_SECRET must be at least 32 characters')
  }
  return createHash('sha256')
    .update(secret)
    .update('\0oryx-private-upload-reference-v1')
    .digest()
}

function expectedKeyPrefix(shopId: string, kind: PrivateUploadKind) {
  return `shops/${shopId}/${kind === 'device' ? 'devices' : 'passports'}/`
}

export function isPrivateUploadStoredKey(input: {
  key: string | null | undefined
  shopId: string
  kind: PrivateUploadKind
}) {
  if (!input.key) return false
  const { key, shopId, kind } = input
  return key.startsWith(expectedKeyPrefix(shopId, kind)) && !key.slice(expectedKeyPrefix(shopId, kind).length).includes('/')
}

export function createPrivateUploadReference(input: {
  key: string
  shopId: string
  kind: PrivateUploadKind
  now?: Date
  ttlMs?: number
  secret?: string
}) {
  if (!isPrivateUploadStoredKey(input)) {
    throw new Error('Private upload key does not belong to the requested tenant and kind')
  }
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', secretValue(input.secret), iv)
  const payload: PrivateUploadPayload = {
    v: 1,
    kind: input.kind,
    shopId: input.shopId,
    key: input.key,
    expiresAt: (input.now ?? new Date()).getTime() + (input.ttlMs ?? DEFAULT_TTL_MS),
  }
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ])
  const tag = cipher.getAuthTag()
  return [TOKEN_VERSION, iv.toString('base64url'), ciphertext.toString('base64url'), tag.toString('base64url')].join('.')
}

export function readPrivateUploadReference(input: {
  reference: string
  kind: PrivateUploadKind
  now?: Date
  secret?: string
}): PrivateUploadPayload | null {
  try {
    const [version, ivValue, ciphertextValue, tagValue, extra] = input.reference.split('.')
    if (version !== TOKEN_VERSION || !ivValue || !ciphertextValue || !tagValue || extra) return null
    const decipher = createDecipheriv(
      'aes-256-gcm',
      secretValue(input.secret),
      Buffer.from(ivValue, 'base64url'),
    )
    decipher.setAuthTag(Buffer.from(tagValue, 'base64url'))
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertextValue, 'base64url')),
      decipher.final(),
    ]).toString('utf8')
    const payload = JSON.parse(plaintext) as Partial<PrivateUploadPayload>
    if (
      payload.v !== 1 ||
      payload.kind !== input.kind ||
      typeof payload.shopId !== 'string' ||
      typeof payload.key !== 'string' ||
      typeof payload.expiresAt !== 'number' ||
      payload.expiresAt <= (input.now ?? new Date()).getTime() ||
      !isPrivateUploadStoredKey({ key: payload.key, shopId: payload.shopId, kind: input.kind })
    ) return null
    return payload as PrivateUploadPayload
  } catch {
    return null
  }
}

export function privateUploadPreviewUrl(kind: PrivateUploadKind, reference: string) {
  return `/api/uploads/${kind}?reference=${encodeURIComponent(reference)}`
}

function extractReference(value: string, kind: PrivateUploadKind) {
  if (value.startsWith(`${TOKEN_VERSION}.`)) return value
  try {
    const url = new URL(value, 'http://oryx.invalid')
    if (url.pathname !== `/api/uploads/${kind}`) return null
    return url.searchParams.get('reference')
  } catch {
    return null
  }
}

/**
 * Resolve an opaque browser reference into the private key stored in
 * PostgreSQL. Raw tenant keys remain accepted only as a backwards-compatible
 * request input; API responses never emit them.
 */
export function resolvePrivateUploadReference(input: {
  value: string
  shopId: string
  kind: PrivateUploadKind
  allowLegacyRawKey?: boolean
  now?: Date
  secret?: string
}) {
  if (input.allowLegacyRawKey && isPrivateUploadStoredKey({ key: input.value, shopId: input.shopId, kind: input.kind })) {
    return input.value
  }
  if (input.allowLegacyRawKey) {
    try {
      const legacyUrl = new URL(input.value, 'http://oryx.invalid')
      const legacyKey = legacyUrl.pathname === `/api/uploads/${input.kind}`
        ? legacyUrl.searchParams.get('key')
        : null
      if (legacyKey && isPrivateUploadStoredKey({ key: legacyKey, shopId: input.shopId, kind: input.kind })) return legacyKey
    } catch {
      // Continue with the opaque-reference path.
    }
  }
  const reference = extractReference(input.value, input.kind)
  if (!reference) return null
  const payload = readPrivateUploadReference({
    reference,
    kind: input.kind,
    now: input.now,
    secret: input.secret,
  })
  return payload?.shopId === input.shopId ? payload.key : null
}
