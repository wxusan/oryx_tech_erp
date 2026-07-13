import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

let requestLimits: typeof import('@/lib/server/request-limits')

beforeAll(async () => {
  requestLimits = await import('@/lib/server/request-limits')
})

describe('bounded request readers', () => {
  it('rejects an oversized declared Content-Length before reading', async () => {
    const request = new Request('https://example.test', {
      method: 'POST',
      headers: { 'content-length': '101' },
      body: 'small',
    })
    await expect(requestLimits.readLimitedRequestBody(request, 100)).rejects.toBeInstanceOf(
      requestLimits.RequestBodyTooLargeError,
    )
  })

  it('rejects actual chunked bytes even without Content-Length', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(60))
        controller.enqueue(new Uint8Array(60))
        controller.close()
      },
    })
    const request = new Request('https://example.test', {
      method: 'POST',
      body: stream,
      // Required by Node's Request implementation for a streamed request.
      duplex: 'half',
    } as RequestInit & { duplex: 'half' })
    await expect(requestLimits.readLimitedRequestBody(request, 100)).rejects.toBeInstanceOf(
      requestLimits.RequestBodyTooLargeError,
    )
  })

  it('parses valid JSON and rejects malformed JSON', async () => {
    const valid = new Request('https://example.test', { method: 'POST', body: '{"ok":true}' })
    await expect(requestLimits.readLimitedJsonBody(valid, 100)).resolves.toEqual({ ok: true })

    const invalid = new Request('https://example.test', { method: 'POST', body: '{' })
    await expect(requestLimits.readLimitedJsonBody(invalid, 100)).rejects.toBeInstanceOf(
      requestLimits.InvalidRequestBodyError,
    )
  })

  it('parses bounded multipart form data', async () => {
    const form = new FormData()
    form.set('shopId', 'shop-1')
    form.set('file', new File([new Uint8Array([1, 2, 3])], 'x.png', { type: 'image/png' }))
    const request = new Request('https://example.test', { method: 'POST', body: form })
    const parsed = await requestLimits.readLimitedFormDataBody(request, 4_096)
    expect(parsed.get('shopId')).toBe('shop-1')
    expect(parsed.get('file')).toBeInstanceOf(File)
  })
})
