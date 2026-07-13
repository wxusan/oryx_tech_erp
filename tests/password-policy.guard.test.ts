import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const routeFiles = [
  'src/app/api/shops/[id]/admins/route.ts',
  'src/app/api/shop-admin/profile/route.ts',
  'src/app/api/admin/profile/route.ts',
]

describe('password policy', () => {
  it('defines the ten-character minimum once in the shared password schema', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/lib/validations.ts'), 'utf8')
    expect(source).not.toMatch(/\.min\((6|8),\s*["']/)
    expect(source).toContain('.min(10,')
    expect(source).toContain('isBcryptPasswordWithinLimit')
  })

  it.each(routeFiles)('%s uses the shared password schema', (file) => {
    const source = readFileSync(resolve(process.cwd(), file), 'utf8')
    expect(source).not.toMatch(/\.min\((6|8),\s*["']/)
    expect(source).toContain('passwordSchema')
  })
})
