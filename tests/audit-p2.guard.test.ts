import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function read(rel: string) {
  return readFileSync(resolve(process.cwd(), rel), 'utf8').replace(/\s+/g, ' ')
}

describe('P2 upload hardening guard', () => {
  it('validates fully decoded images before private storage upload', () => {
    for (const route of ['src/app/api/uploads/passport/route.ts', 'src/app/api/uploads/device/route.ts']) {
      const src = read(route)
      expect(src).toContain('validatePrivateUploadImage')
      expect(src.indexOf('validatePrivateUploadImage(bytes, file.type)')).toBeLessThan(src.indexOf('.upload(key, bytes'))
      expect(src).toContain('Rasm fayli formati')
      expect(src).toContain('shikastlangan')
    }

    const validator = read('src/lib/server/image-validation.ts')
    expect(validator).toContain('hasValidImageSignature(bytes, mimeType)')
    expect(validator).toContain('limitInputPixels: PRIVATE_UPLOAD_MAX_PIXELS')
    expect(validator).toContain('await image.stats()')
  })
})
