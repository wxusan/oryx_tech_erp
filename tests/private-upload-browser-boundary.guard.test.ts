import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(path, 'utf8')

describe('private upload browser boundary', () => {
  it('returns only opaque upload references and never raw storage keys', () => {
    for (const path of [
      'src/app/api/uploads/device/route.ts',
      'src/app/api/uploads/passport/route.ts',
    ]) {
      const source = read(path)
      expect(source, path).toContain('createPrivateUploadReference')
      expect(source, path).toContain('reference,')
      expect(source, path).not.toContain('return ok({ key')
      expect(source, path).not.toContain("searchParams.get('key')")
    }
  })

  it('unwraps browser references server-side before private keys enter business rows', () => {
    for (const path of [
      'src/app/api/devices/route.ts',
      'src/app/api/devices/[id]/route.ts',
      'src/app/api/devices/[id]/nasiya/route.ts',
      'src/app/api/olib-sotdim/route.ts',
      'src/app/api/nasiya/import/route.ts',
      'src/app/api/customers/route.ts',
      'src/app/api/customers/[id]/route.ts',
    ]) {
      expect(read(path), path).toContain('resolvePrivateUploadReference')
    }
  })

  it('does not expose private device or passport keys through client DTOs or query strings', () => {
    const deviceApi = read('src/app/api/devices/[id]/route.ts')
    const deviceClient = read('src/app/(shop)/shop/qurilmalar/[id]/page.tsx')
    const nasiyaApi = read('src/app/api/nasiya/[id]/route.ts')
    const nasiyaClient = read('src/app/(shop)/shop/nasiyalar/[id]/page.tsx')

    expect(deviceApi).toContain("privateUploadPreviewUrl('device', reference)")
    expect(deviceClient).not.toContain('/api/uploads/device?key=')
    expect(nasiyaApi).toContain('...(canViewPassportPhoto ? { passportPhotoUrl: true } : {})')
    expect(nasiyaApi).toContain('...(canViewPassportPhoto ? { hasPassportPhoto: Boolean(passportPhotoUrl) } : {})')
    expect(nasiyaApi).not.toContain('customer: nasiya.customer')
    expect(nasiyaClient).not.toContain('customer?.passportPhotoUrl')
    expect(nasiyaClient).not.toContain('/api/uploads/passport?key=')
    expect(nasiyaClient).toContain('/passport/image')
  })
})
