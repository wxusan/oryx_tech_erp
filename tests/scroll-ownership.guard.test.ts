import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function read(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8')
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.(?:ts|tsx)$/.test(entry.name) ? [path] : []
  })
}

describe('single-scroll ownership', () => {
  it('does not use absolutely positioned sr-only captions inside table scrollports', () => {
    const offenders = sourceFiles(resolve(process.cwd(), 'src')).filter((path) => (
      /<caption\b[^>]*className=["'][^"']*\bsr-only\b/.test(readFileSync(path, 'utf8'))
    ))

    expect(offenders).toEqual([])
  })

  it('uses visible headings as accessible names for every affected nasiya table', () => {
    const history = read('src/components/shop/nasiya-history-sections.tsx')
    const preview = read('src/components/shop/nasiya-schedule-preview.tsx')

    expect(history).toContain('<table aria-labelledby="nasiya-schedule-heading"')
    expect(history).toContain('<table aria-labelledby="nasiya-payments-heading"')
    expect(preview).toContain('id="nasiya-schedule-preview-heading"')
    expect(preview).toContain('<table aria-labelledby="nasiya-schedule-preview-heading"')
  })

  it('constrains the authenticated shells and gives vertical scrolling to main', () => {
    for (const path of [
      'src/app/(shop)/shop-layout-client.tsx',
      'src/app/(admin)/admin-layout-client.tsx',
    ]) {
      const shell = read(path)
      expect(shell).toContain('min-h-dvh')
      expect(shell).toContain('md:h-dvh md:min-h-0')
      expect(shell).toContain('flex min-h-0 min-w-0 flex-1 flex-col')
      expect(shell).toContain('min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto')
    }
  })

  it('sizes the new-operation page from its parent instead of a mismatched viewport calculation', () => {
    const page = read('src/app/(shop)/shop/yangi-operatsiya/page.tsx')
    expect(page).toContain('flex min-h-full flex-col')
    expect(page).not.toContain('min-h-[calc(100vh-3rem)]')
  })
})
