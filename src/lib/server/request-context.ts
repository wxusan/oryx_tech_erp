import { AsyncLocalStorage } from 'node:async_hooks'
import { createHmac, randomUUID } from 'node:crypto'
import { isIP } from 'node:net'
import { headers as nextHeaders } from 'next/headers'

export interface RequestAuditContext {
  requestId: string
  /** One-way, deployment-secret-scoped fingerprint. Never a raw IP address. */
  networkId: string | null
}

type HeaderReader = Pick<Headers, 'get'>

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{8,160}$/
const requestStorage = new AsyncLocalStorage<RequestAuditContext>()

function safeRequestId(value: string | null) {
  const normalized = value?.trim() ?? ''
  return REQUEST_ID_PATTERN.test(normalized) ? normalized : null
}

function requestNetworkAddress(headers: HeaderReader) {
  // Vercel documents x-vercel-forwarded-for as the protected client address.
  // The x-forwarded-for fallback is only used outside Vercel (for local or
  // explicitly trusted reverse-proxy deployments).
  const raw = headers.get('x-vercel-forwarded-for')
    ?? (process.env.VERCEL ? null : headers.get('x-forwarded-for'))
  const candidate = raw?.split(',')[0]?.trim() ?? ''
  return isIP(candidate) ? candidate : null
}

function networkFingerprint(headers: HeaderReader) {
  const address = requestNetworkAddress(headers)
  const secret = process.env.AUDIT_NETWORK_HASH_SECRET
    ?? process.env.AUTH_SECRET
    ?? process.env.NEXTAUTH_SECRET
  if (!address || !secret || Buffer.byteLength(secret, 'utf8') < 32) return null

  const digest = createHmac('sha256', secret)
    .update('oryx-audit-network-v1\0')
    .update(address)
    .digest('hex')
    .slice(0, 32)
  return `h1:${digest}`
}

export function requestAuditContextFromHeaders(headers: HeaderReader): RequestAuditContext {
  return {
    requestId: safeRequestId(headers.get('x-request-id'))
      ?? safeRequestId(headers.get('x-vercel-id'))
      ?? randomUUID(),
    networkId: networkFingerprint(headers),
  }
}

/** Initialize the current request's async context before auth/business work. */
export async function initializeRequestAuditContext(headers?: HeaderReader) {
  let resolvedHeaders = headers
  if (!resolvedHeaders) {
    try {
      resolvedHeaders = await nextHeaders()
    } catch {
      // Direct Route Handler integration tests and non-HTTP service calls do
      // not have Next's request AsyncLocalStorage. They still receive a unique
      // correlation ID, but never invent network context.
      resolvedHeaders = new Headers()
    }
  }
  const context = requestAuditContextFromHeaders(resolvedHeaders)
  requestStorage.enterWith(context)
  return context
}

export function currentRequestAuditContext(): RequestAuditContext | null {
  return requestStorage.getStore() ?? null
}

export function currentBusinessLogContext() {
  const context = currentRequestAuditContext()
  return context
    ? { requestId: context.requestId, ipAddress: context.networkId }
    : { requestId: null, ipAddress: null }
}

/** Test/service helper for code that does not start in a Next.js request. */
export function withRequestAuditContext<T>(
  context: RequestAuditContext,
  callback: () => T,
): T {
  return requestStorage.run(context, callback)
}
