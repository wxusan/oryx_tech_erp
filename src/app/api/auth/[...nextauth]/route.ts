import { handlers } from '@/lib/auth'
import { NextRequest } from 'next/server'
import { badRequest, payloadTooLarge } from '@/lib/api-helpers'
import { logger } from '@/lib/logger'
import {
  BCRYPT_PASSWORD_TOO_LONG_MESSAGE,
  isBcryptPasswordWithinLimit,
} from '@/lib/password-policy'
import {
  AUTH_MAX_REQUEST_BYTES,
  isRequestBodyTooLarge,
  readLimitedRequestBody,
} from '@/lib/server/request-limits'

export const GET = handlers.GET

function copyToArrayBuffer(body: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(body.byteLength)
  new Uint8Array(copy).set(body)
  return copy
}

async function passwordFromBody(body: Buffer, contentType: string): Promise<unknown> {
  const normalizedContentType = contentType.toLowerCase()
  if (normalizedContentType.includes('application/json')) {
    const value: unknown = JSON.parse(body.toString('utf8'))
    return typeof value === 'object' && value !== null && 'password' in value
      ? (value as { password?: unknown }).password
      : undefined
  }
  if (normalizedContentType.includes('multipart/form-data')) {
    const form = await new Response(copyToArrayBuffer(body), {
      headers: { 'content-type': contentType },
    }).formData()
    return form.get('password')
  }
  return new URLSearchParams(body.toString('utf8')).get('password')
}

/** Bound Auth.js credential parsing before bcrypt or Auth.js buffers the body. */
export async function POST(request: Request) {
  try {
    const body = await readLimitedRequestBody(request, AUTH_MAX_REQUEST_BYTES)
    const contentType = request.headers.get('content-type') ?? ''
    const password = await passwordFromBody(body, contentType)
    if (typeof password === 'string' && !isBcryptPasswordWithinLimit(password)) {
      return badRequest(BCRYPT_PASSWORD_TOO_LONG_MESSAGE)
    }

    const forwarded = new NextRequest(request.url, {
      method: request.method,
      headers: request.headers,
      body: copyToArrayBuffer(body),
    })
    return handlers.POST(forwarded)
  } catch (error) {
    if (isRequestBodyTooLarge(error)) return payloadTooLarge()
    logger.warn('[POST /api/auth/[...nextauth]] invalid credential request', {
      event: 'auth.invalid_request',
      error,
    })
    return badRequest("Kirish so'rovi noto'g'ri")
  }
}
