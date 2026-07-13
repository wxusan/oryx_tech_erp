import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

describe('security input-boundary route guards', () => {
  it('bounds and byte-validates the Auth.js credentials request', () => {
    const source = read('src/app/api/auth/[...nextauth]/route.ts')
    expect(source).toContain('readLimitedRequestBody(request, AUTH_MAX_REQUEST_BYTES)')
    expect(source).toContain('isBcryptPasswordWithinLimit(password)')
  })

  it.each([
    'src/app/api/admin/profile/route.ts',
    'src/app/api/shop-admin/profile/route.ts',
    'src/app/api/shops/route.ts',
    'src/app/api/shops/[id]/admins/route.ts',
  ])('uses bounded JSON parsing in %s', (path) => {
    expect(read(path)).toContain('readLimitedJsonBody(req)')
  })

  it.each([
    'src/app/api/uploads/device/route.ts',
    'src/app/api/uploads/passport/route.ts',
  ])('bounds multipart data and validates decoded images in %s', (path) => {
    const source = read(path)
    expect(source).toContain('readLimitedFormDataBody(request, PRIVATE_UPLOAD_MAX_REQUEST_SIZE)')
    expect(source).toContain('validatePrivateUploadImage(bytes, file.type)')
  })
})
