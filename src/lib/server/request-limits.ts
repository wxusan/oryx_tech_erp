import 'server-only'

export const DEFAULT_MAX_JSON_REQUEST_BYTES = 64 * 1024
export const AUTH_MAX_REQUEST_BYTES = 16 * 1024

export class RequestBodyTooLargeError extends Error {
  readonly maxBytes: number

  constructor(maxBytes: number) {
    super(`Request body exceeds ${maxBytes} bytes`)
    this.name = 'RequestBodyTooLargeError'
    this.maxBytes = maxBytes
  }
}

export class InvalidRequestBodyError extends Error {
  constructor(message = 'Invalid request body') {
    super(message)
    this.name = 'InvalidRequestBodyError'
  }
}

export function isRequestBodyTooLarge(error: unknown): error is RequestBodyTooLargeError {
  return error instanceof RequestBodyTooLargeError
}

export function isInvalidRequestBody(error: unknown): error is InvalidRequestBodyError {
  return error instanceof InvalidRequestBodyError
}

function assertContentLengthWithinLimit(request: Request, maxBytes: number) {
  const header = request.headers.get('content-length')
  if (!header) return
  const declaredBytes = Number(header)
  if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
    throw new RequestBodyTooLargeError(maxBytes)
  }
}

/**
 * Read an HTTP body while enforcing the limit against both Content-Length and
 * the actual stream. The stream check protects chunked/missing-header requests
 * before a JSON or multipart parser is allowed to buffer an unbounded body.
 */
export async function readLimitedRequestBody(request: Request, maxBytes: number): Promise<Buffer> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new TypeError('maxBytes must be a positive safe integer')
  }
  assertContentLengthWithinLimit(request, maxBytes)
  if (!request.body) return Buffer.alloc(0)

  const reader = request.body.getReader()
  const chunks: Buffer[] = []
  let totalBytes = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > maxBytes) {
        await reader.cancel('request body limit exceeded')
        throw new RequestBodyTooLargeError(maxBytes)
      }
      chunks.push(Buffer.from(value))
    }
  } finally {
    reader.releaseLock()
  }

  return Buffer.concat(chunks, totalBytes)
}

export async function readLimitedJsonBody(
  request: Request,
  maxBytes = DEFAULT_MAX_JSON_REQUEST_BYTES,
): Promise<unknown> {
  const body = await readLimitedRequestBody(request, maxBytes)
  if (body.byteLength === 0) throw new InvalidRequestBodyError('JSON body is empty')
  try {
    return JSON.parse(body.toString('utf8')) as unknown
  } catch {
    throw new InvalidRequestBodyError('JSON body is malformed')
  }
}

export async function readLimitedFormDataBody(request: Request, maxBytes: number): Promise<FormData> {
  const contentType = request.headers.get('content-type')
  if (!contentType?.toLowerCase().startsWith('multipart/form-data')) {
    throw new InvalidRequestBodyError('multipart/form-data is required')
  }
  const body = await readLimitedRequestBody(request, maxBytes)
  try {
    const responseBody = new ArrayBuffer(body.byteLength)
    new Uint8Array(responseBody).set(body)
    return await new Response(responseBody, { headers: { 'content-type': contentType } }).formData()
  } catch {
    throw new InvalidRequestBodyError('Multipart body is malformed')
  }
}
