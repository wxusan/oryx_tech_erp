import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8')

describe('new device back navigation', () => {
  it('returns to Yangi operatsiya only when opened from that page', () => {
    const operations = read('src/app/(shop)/shop/yangi-operatsiya/page.tsx')
    const page = read('src/app/(shop)/shop/qurilmalar/new/page.tsx')

    expect(operations).toContain("href: '/shop/qurilmalar/new?from=yangi-operatsiya'")
    expect(page).toContain("searchParams.get('from') === 'yangi-operatsiya'")
    expect(page).toContain("const backHref = openedFromNewOperation ? '/shop/yangi-operatsiya' : '/shop/qurilmalar'")
    expect(page).toContain("const backLabel = openedFromNewOperation ? 'Orqaga qaytish' : 'Qurilmalarga qaytish'")
  })
})
