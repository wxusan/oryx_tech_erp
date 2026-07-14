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
    ]

    const positions = sidebarHrefs.map((href) => shell.indexOf(`href: '${href}'`))
    expect(positions.every((position) => position >= 0)).toBe(true)
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
  })

  it('keeps Olib-sotdim, Import, and Eksport out of the sidebar while moving reports to the header', () => {
    expect(shell).not.toContain("href: '/shop/olib-sotdim'")
    expect(shell).not.toContain("href: '/shop/import'")
    expect(shell).not.toContain("href: '/shop/eksport'")
    expect(shell).toContain("href: '/shop/hisobot'")
    expect(shell).toContain('sidebar: false, header: true')
  })

  it('derives sidebar and header links from the same permission-filtered set', () => {
    expect(shell).toContain('const visibleSidebarLinks = permittedNavLinks.filter((link) => link.sidebar)')
    expect(shell).toContain('const visibleHeaderLinks = permittedNavLinks.filter((link) => link.header)')
  })
})
