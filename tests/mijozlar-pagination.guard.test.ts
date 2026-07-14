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
describe('customer list query: real pagination envelope', () => {
  const route = read('src/app/api/customers/route.ts')
  const query = read('src/lib/server/customer-list.ts')
  const searchRoute = read('src/app/api/customers/search/route.ts')

  it('returns items/total/skip/take (same envelope shape /api/logs already established)', () => {
    expect(query).toContain('return { items, total, skip: input.skip, take: input.take }')
    expect(route).toContain('return ok(data, "Mijozlar ro\'yxati")')
    expect(searchRoute).toContain("const response = ok(scopedData, 'Mijoz qidiruvi')")
  })

  it('runs count() with the exact same where clause as findMany, in parallel', () => {
    expect(query).toContain('prisma.customer.count({ where })')
    expect(query).toContain('Promise.all([')
  })

  it('page size is a real per-page size, not the old 200/500 load-everything default', () => {
    expect(route).toContain("Number(searchParams.get('take') ?? 25)")
    expect(searchRoute).toContain('take: z.number().int().min(1).max(100).default(25)')
  })
})

describe('mijozlar page: page state, total, and a submit-triggered search that resets to page 1', () => {
  const page = read('src/app/(shop)/shop/mijozlar/customers-client.tsx')

  it('keys the query cache by page and reads the real total', () => {
    expect(page).toContain('const [page, setPage] = useState(initialPage)')
    expect(page).toContain("queryKeys.list(scope, 'customers'")
    expect(page).toContain('const total = customersQuery.data?.total ?? 0')
  })

  it('a new search always resets to page 1', () => {
    expect(page).toContain('function submitSearch() {\n    setCommittedSearch(search.trim())')
    expect(page).toContain('loadPage(1)')
  })

  it('keeps the private search in a POST body and out of URL/history/query keys', () => {
    expect(page).toContain("'/api/customers/search'")
    expect(page).toContain('customerSearchRequest({')
    expect(read('src/lib/customer-search-transport.ts')).toContain("method: 'POST'")
    expect(page).toContain('requestRevision: searchRevision')
    expect(page).not.toContain('search: committedSearch,\n      page,')
    expect(page).toContain('replaceListUrlState({ q: null, page')
    expect(page).not.toContain('replaceListUrlState({ q: query')
  })

  it('reads items/total from the new response envelope, not a raw array', () => {
    expect(page).toContain('data?: { items: Customer[]; total: number }')
    expect(page).toContain('const customers = customersQuery.data?.items ?? []')
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
    const mobileBlock = page.slice(mobileBlockStart, mobileBlockStart + 2500)
    expect(mobileBlock).toContain('Tahrirlash')
  })
})
