import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

describe('Uzbek phone input consistency', () => {
  it.each([
    'src/app/(shop)/shop/qurilmalar/new/page.tsx',
    'src/app/(shop)/shop/qurilmalar/[id]/page.tsx',
    'src/app/(shop)/shop/nasiyalar/import/page.tsx',
    'src/app/(shop)/shop/nasiyalar/[id]/page.tsx',
    'src/app/(shop)/shop/settings/page.tsx',
    'src/app/(admin)/admin/shops/new/page.tsx',
    'src/app/(admin)/admin/shops/[id]/page.tsx',
  ])('%s uses the shared PhoneInput for editable phone fields', (file) => {
    const source = read(file)
    expect(source).toContain("from '@/components/ui/phone-input'")
    expect(source).toContain('<PhoneInput')
  })

  it('keeps all shared create/update schemas on the canonical phone validator', () => {
    const validations = read('src/lib/validations.ts')
    expect(validations).toContain('.refine(isValidPhone, PHONE_ERROR)')
    expect(validations).toContain('.transform((phone) => normalizeUzPhone(phone)!)')

    for (const file of [
      'src/app/api/customers/[id]/route.ts',
      'src/app/api/sales/[id]/route.ts',
      'src/app/api/nasiya/[id]/route.ts',
      'src/app/api/shops/[id]/route.ts',
      'src/app/api/shops/[id]/admins/route.ts',
      'src/app/api/shop/profile/route.ts',
      'src/app/api/shop-admin/profile/route.ts',
      'src/app/api/import/customers/route.ts',
    ]) {
      expect(read(file), file).toContain("import { phoneSchema } from '@/lib/validations'")
    }
  })
})
