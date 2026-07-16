import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

/**
 * Real page/skip/take pagination for the nasiyalar list, replacing the old
 * single fetch capped at SHOP_LIST_HARD_CAP (500) rows with a "truncated"
 * banner and no way to reach hidden rows. Mirrors
 * tests/mijozlar-pagination.guard.test.ts and tests/qurilmalar-pagination.guard.test.ts.
 */
describe('GET /api/nasiya: real pagination envelope', () => {
  const route = read('src/app/api/nasiya/route.ts')

  it('returns items/total/skip/take (same envelope shape /api/logs and /api/customers already established)', () => {
    expect(route).toContain("ok({ items, total, skip, take }")
  })

  it('delegates to getShopNasiyalarList (shared with the SSR first page, so they never drift apart)', () => {
    expect(route).toContain('getShopNasiyalarList(shopId, { search, status, cohort, resolutionState, skip, take })')
  })

  it('page size is a real per-page size, not the old 200/500 load-everything default', () => {
    expect(route).toContain("Number(searchParams.get('take') ?? 25)")
  })
})

describe('shop-lists.ts getShopNasiyalarList: search/status/skip/take/total', () => {
  const source = read('src/lib/server/shop-lists.ts')

  it('accepts search/status/skip/take and counts with the same where as findMany', () => {
    expect(source).toContain('export interface ShopNasiyalarQuery')
    expect(source).toContain('prisma.nasiya.count({ where })')
  })

  it('search matches customer name/phone, device model/both IMEIs, and note', () => {
    expect(source).toContain("{ customer: { name: { contains: search, mode: 'insensitive' as const } } }")
    expect(source).toContain("{ device: { model: { contains: search, mode: 'insensitive' as const } } }")
    expect(source).toContain('device: {')
    expect(source).toContain('imeis: {')
  })
})

describe('nasiyalar page/client: page state, total, and pagination controls', () => {
  const page = read('src/app/(shop)/shop/nasiyalar/page.tsx')
  const client = read('src/app/(shop)/shop/nasiyalar/nasiyalar-client.tsx')

  it('page fetches only the first page server-side and forwards initialNasiyalar/initialTotal', () => {
    expect(page).toContain('initialNasiyalar={nasiyalar}')
    expect(page).toContain('initialTotal={total}')
  })

  it('client has page state and resets to page 1 when the search or status filter changes', () => {
    expect(client).toContain('const [page, setPage] = useState(initialPage)')
    expect(client).toContain("setSearch(e.target.value); setPage(1)")
    expect(client).toContain('setActiveFilter(tab.value); setPage(1)')
  })

  it('renders Prev/Next controls gated on the real total, disabled at the boundaries', () => {
    expect(client).toContain('disabled={page === 1}')
    expect(client).toContain('disabled={page === totalPages}')
  })

  it('no more client-side nasiyalar.filter()/matchesNasiyaSearch — filtering is server-side now', () => {
    expect(client).not.toContain('matchesNasiyaSearch')
    expect(client).not.toContain('nasiyalar.filter(')
  })
})

describe('nasiyalar client: responsive card views', () => {
  const client = read('src/app/(shop)/shop/nasiyalar/nasiyalar-client.tsx')

  it('uses a comfortable multi-column card grid from sm: up', () => {
    expect(client).toContain('hidden sm:grid grid-cols-1 gap-3 xl:grid-cols-2 2xl:grid-cols-3')
  })

  it('a separate card list is shown only below sm:, with a full-card detail link and the payment action', () => {
    expect(client).toContain('sm:hidden space-y-3')
    const mobileBlockStart = client.indexOf('sm:hidden space-y-3')
    // The cohort amount/context adds a little more mobile-card markup; keep
    // this guard scoped to the mobile block without truncating its actions.
    const mobileBlock = client.slice(mobileBlockStart, mobileBlockStart + 6500)
    expect(mobileBlock).toContain('<StretchedLink href={`/shop/nasiyalar/${n.id}`}')
    expect(mobileBlock).toContain("To&apos;lov qabul qilish")
    expect(mobileBlock).toContain('onClick={() => setPayFor(n)}')
  })
})
