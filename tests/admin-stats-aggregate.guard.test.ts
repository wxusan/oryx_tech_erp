import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const route = readFileSync(resolve(process.cwd(), 'src/app/api/stats/admin/route.ts'), 'utf8')

describe('admin expected revenue aggregate', () => {
  it('does not derive platform revenue from a capped shop list', () => {
    expect(route).not.toContain('take: 2000')
    expect(route).not.toContain('shops.reduce')
    expect(route).toContain('LEFT JOIN LATERAL')
    expect(route).toContain('AS expected_uzs')
    expect(route).toContain('AS expected_usd')
    expect(route).toContain("FILTER (WHERE current_package.currency = 'UZS')")
  })
})
