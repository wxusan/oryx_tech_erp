import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

/**
 * Items 7 (search by comment/izoh everywhere) and 14 (search by name
 * everywhere): the server-side list search endpoints used to be missing a
 * `note` clause (customers, devices, nasiya) and a customer-name clause
 * (devices only — nasiya already searched customer name). This guards the
 * fix at the source-text level (these routes touch Prisma, so they can't be
 * imported directly in Vitest — same pattern as every other `.guard.test.ts`
 * in this repo).
 */
describe('server-side search covers note/comment fields', () => {
  it('POST /api/customers/search searches the customer note field', () => {
    const route = read('src/app/api/customers/search/route.ts')
    const query = read('src/lib/server/customer-list.ts')
    const helper = read('src/lib/server/customer-search.ts')
    expect(route).toContain('getCustomerList({')
    expect(query).toContain('customerSearchWhere(input.shopId, input.search, { includeNote: true })')
    expect(helper).toMatch(/options\.includeNote[\s\S]*\[\{\s*note:\s*\{\s*contains:\s*prepared\.escapedText/)
    expect(helper).toContain('shopId,')
    expect(helper).toContain('deletedAt: null')
  })

  it('GET /api/devices searches the device note field', () => {
    const source = read('src/lib/server/shop-lists.ts')
    expect(source).toMatch(/\{\s*note:\s*\{\s*contains:\s*search/)
    expect(source).toMatch(/supplier:\s*\{\s*name:\s*\{\s*contains:\s*search/)
    const route = read('src/app/api/devices/route.ts')
    expect(route).toContain("buildShopDevicesWhere(shopId, { search, status: 'IN_STOCK' })")
  })

  it('GET /api/nasiya searches the nasiya note field', () => {
    // GET /api/nasiya now delegates its query to getShopNasiyalarList in
    // shop-lists.ts (shared with the nasiyalar list page's server-rendered
    // first page, so the two never drift apart) — the search OR clause
    // lives there, not inlined in the route file.
    const source = read('src/lib/server/shop-lists.ts')
    expect(source).toMatch(/\{\s*note:\s*\{\s*contains:\s*search/)
  })

  it('GET /api/olib-sotdim already searched supplierNote before this pass (no regression)', () => {
    const source = read('src/app/api/olib-sotdim/route.ts')
    expect(source).toContain('supplierNote')
  })
})

describe('server-side search covers customer name (item 14)', () => {
  it('GET /api/devices searches the sale/nasiya customer name, not just phone', () => {
    const source = read('src/lib/server/shop-lists.ts')
    expect(source).toMatch(/sales:\s*\{\s*some:\s*\{\s*customer:\s*\{\s*name:/)
    expect(source).toMatch(/nasiya:\s*\{\s*some:\s*\{\s*customer:\s*\{\s*name:/)
  })

  it('GET /api/nasiya already searched customer name before this pass (no regression)', () => {
    // See the note-field test above — logic now lives in shop-lists.ts.
    const source = read('src/lib/server/shop-lists.ts')
    expect(source).toMatch(/customer:\s*\{\s*name:\s*\{\s*contains:\s*search/)
  })
})

describe('server-side search matches additional customer phones (item 4)', () => {
  it('POST /api/customers/search matches a partial number in the delimiter-safe phone document', () => {
    const route = read('src/app/api/customers/search/route.ts')
    const query = read('src/lib/server/customer-list.ts')
    const helper = read('src/lib/server/customer-search.ts')
    expect(route).toContain('getCustomerList({')
    expect(query).toContain('customerSearchWhere(input.shopId, input.search, { includeNote: true })')
    expect(helper).toMatch(/phoneSearchDigits:\s*\{\s*contains:/)
    expect(helper).not.toMatch(/additionalPhones:\s*\{\s*has:/)
    expect(helper).toContain('shopId,')
    expect(helper).toContain('deletedAt: null')
  })

  it('GET /api/devices matches a partial sale/nasiya customer phone', () => {
    const source = read('src/lib/server/shop-lists.ts')
    expect(source).toMatch(/customer:\s*\{\s*phoneSearchDigits:\s*\{\s*contains:/)
    expect(source).not.toMatch(/additionalPhones:\s*\{\s*has:/)
  })

  it('GET /api/nasiya matches a partial customer phone', () => {
    // See the note-field test above — logic now lives in shop-lists.ts.
    const source = read('src/lib/server/shop-lists.ts')
    expect(source).toMatch(/customer:\s*\{\s*phoneSearchDigits:\s*\{\s*contains:/)
    expect(source).not.toMatch(/additionalPhones:\s*\{\s*has:/)
  })
})
