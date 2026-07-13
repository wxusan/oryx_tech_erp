import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function tsxFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const fullPath = path.join(directory, entry)
    return statSync(fullPath).isDirectory()
      ? tsxFiles(fullPath)
      : fullPath.endsWith('.tsx') ? [fullPath] : []
  })
}

describe('form accessibility source contract', () => {
  it('requires every page label to explicitly name its associated control', () => {
    const root = path.resolve(process.cwd(), 'src')
    const violations = tsxFiles(root)
      .filter((file) => !file.endsWith(path.join('components', 'ui', 'label.tsx')))
      .flatMap((file) => {
        const source = readFileSync(file, 'utf8')
        const native = [...source.matchAll(/<label\b(?![^>]*\bhtmlFor=)[^>]*>/g)]
        const primitive = [...source.matchAll(/<Label\b(?![^>]*\bhtmlFor=)[^>]*>/g)]
        return [...native, ...primitive].map((match) => `${path.relative(root, file)}:${source.slice(0, match.index).split('\n').length}`)
      })

    expect(violations).toEqual([])
  })
})
