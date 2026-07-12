import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const files = [
  'src/lib/validations.ts',
  'src/app/api/shops/[id]/admins/route.ts',
  'src/app/api/shop-admin/profile/route.ts',
  'src/app/api/admin/profile/route.ts',
]

describe('password policy', () => {
  it.each(files)('%s rejects passwords shorter than ten characters', (file) => {
    const source = readFileSync(resolve(process.cwd(), file), 'utf8')
    expect(source).not.toMatch(/\.min\((6|8),\s*["']/)
    expect(source).toContain('.min(10,')
  })
})
