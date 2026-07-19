import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const shell = readFileSync(
  resolve(process.cwd(), 'src/app/(shop)/shop-layout-client.tsx'),
  'utf8',
)

describe('shop navigation order and placement', () => {
  it('keeps the daily shop workflow in the shared sidebar order', () => {
    const sidebarHrefs = [
      '/shop/dashboard',
      '/shop/yangi-operatsiya',
      '/shop/qurilmalar',
      '/shop/sotuvlar',
      '/shop/nasiyalar',
      '/shop/tolovlar',
      '/shop/mijozlar',
      '/shop/logs',
      '/shop/xodimlar',
      '/shop/settings',
      '/shop/hisobot',
    ]

    const positions = sidebarHrefs.map((href) => shell.indexOf(`href: '${href}'`))
    expect(positions.every((position) => position >= 0)).toBe(true)
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
  })

  it('keeps Olib-sotdim, Import, and Eksport out of the sidebar while placing reports last', () => {
    expect(shell).not.toContain("href: '/shop/olib-sotdim'")
    expect(shell).not.toContain("href: '/shop/import'")
    expect(shell).not.toContain("href: '/shop/eksport'")
    expect(shell.indexOf("href: '/shop/hisobot'")).toBeGreaterThan(shell.indexOf("href: '/shop/settings'"))
    expect(shell).toContain("permission: 'REPORT_VIEW'")
  })

  it('keeps header shortcuts removed while preserving the permission-filtered sidebar', () => {
    expect(shell).toContain('const visibleSidebarLinks = permittedNavLinks')
    expect(shell).not.toContain('visibleHeaderLinks')
    expect(shell).not.toContain('Tezkor navigatsiya')
    expect(shell.match(/href: '\/shop\/yangi-operatsiya'/g)).toHaveLength(1)
    expect(shell.match(/href: '\/shop\/hisobot'/g)).toHaveLength(1)
  })
})
