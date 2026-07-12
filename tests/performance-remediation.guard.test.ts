import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function read(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8')
}

describe('bounded inventory picker', () => {
  const route = read('src/app/api/devices/route.ts')
  const picker = read('src/components/shop/in-stock-device-picker.tsx')

  it('uses a minimal projection with a 50-row hard ceiling', () => {
    const pickerBranch = route.slice(route.indexOf("searchParams.get('view') === 'picker'"), route.indexOf('// Item —'))
    expect(pickerBranch).toContain('Math.min(Math.max(requestedTake, 1), 50)')
    expect(pickerBranch).toContain('purchasePrice: true')
    expect(pickerBranch).not.toContain('sales:')
    expect(pickerBranch).not.toContain('nasiya:')
    expect(pickerBranch).not.toContain('returns:')
    expect(pickerBranch).not.toContain('supplier:')
  })

  it('debounces, rejects one-character scans and cancels stale page requests', () => {
    expect(picker).toContain('const SEARCH_DEBOUNCE_MS = 250')
    expect(picker).toContain('debouncedQuery.length === 1')
    expect(picker).toContain('kamida 2 ta belgi')
    expect(picker).toContain('loadMoreController.current?.abort()')
    expect(picker).toContain('{ signal: controller.signal }')
  })
})

describe('persistent-shell request reduction', () => {
  const banner = read('src/components/shop/due-overdue-banner.tsx')

  it('uses event/focus refresh with a five-minute polling safety net', () => {
    expect(banner).toContain('const FALLBACK_REFRESH_MS = 5 * 60_000')
    expect(banner).toContain('FINANCIAL_DATA_CHANGED_EVENT')
    expect(banner).not.toContain('setInterval(load, 60_000)')
  })

})
