import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

/**
 * Item 2 — true page/skip/take pagination for the customers (mijozlar)
 * list, replacing the old single unbounded fetch (default take=200, no
 * total, no next/prev). Item 1 — mobile card view alongside the desktop
 * table.
 */
describe('GET /api/customers: real pagination envelope', () => {
  const route = read('src/app/api/customers/route.ts')

  it('returns items/total/skip/take (same envelope shape /api/logs already established)', () => {
    expect(route).toContain('ok({ items: withTrust, total, skip, take }')
  })

  it('runs count() with the exact same where clause as findMany, in parallel', () => {
    expect(route).toContain('prisma.customer.count({ where })')
    expect(route).toContain('Promise.all([')
  })

  it('page size is a real per-page size, not the old 200/500 load-everything default', () => {
    expect(route).toContain("Number(searchParams.get('take') ?? 25)")
  })
})

describe('mijozlar page: page state, total, and a submit-triggered search that resets to page 1', () => {
  const page = read('src/app/(shop)/shop/mijozlar/customers-client.tsx')

  it('has page/total state and re-fetches when page changes', () => {
    expect(page).toContain('const [page, setPage] = useState(initialPage)')
    expect(page).toContain('const [total, setTotal] = useState(0)')
    expect(page).toContain('requestCustomers(initialSearch, initialPage)')
  })

  it('a new search always resets to page 1', () => {
    expect(page).toContain('function submitSearch() {\n    setPage(1)\n    loadCustomers(search, 1)')
  })

  it('reads items/total from the new response envelope, not a raw array', () => {
    expect(page).toContain('setCustomers(json.data.items)')
    expect(page).toContain('setTotal(json.data.total)')
  })

  it('renders Prev/Next controls gated on the real total, disabled at the boundaries', () => {
    expect(page).toContain('disabled={page === 1}')
    expect(page).toContain('disabled={page === totalPages}')
  })
})

describe('mijozlar page: mobile card view alongside the desktop table (item 1)', () => {
  const page = read('src/app/(shop)/shop/mijozlar/customers-client.tsx')

  it('desktop table is hidden below sm:, shown from sm: up', () => {
    expect(page).toContain('hidden sm:block border border-zinc-200 rounded overflow-x-auto')
  })

  it('a separate card list is shown only below sm:, with the edit action directly visible (not in an overflow menu)', () => {
    expect(page).toContain('sm:hidden space-y-3')
    const mobileBlockStart = page.indexOf('sm:hidden space-y-3')
    const mobileBlock = page.slice(mobileBlockStart, mobileBlockStart + 1500)
    expect(mobileBlock).toContain('Tahrirlash')
  })
})
