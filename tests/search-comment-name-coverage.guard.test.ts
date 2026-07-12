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
  it('GET /api/customers searches the customer note field', () => {
    const source = read('src/app/api/customers/route.ts')
    expect(source).toMatch(/\{\s*note:\s*\{\s*contains:\s*search/)
  })

  it('GET /api/devices searches the device note field', () => {
    const source = read('src/lib/server/shop-lists.ts')
    expect(source).toMatch(/\{\s*note:\s*\{\s*contains:\s*search/)
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
  it('GET /api/customers matches additionalPhones', () => {
    const source = read('src/app/api/customers/route.ts')
    expect(source).toContain("additionalPhones: { has: searchDigits }")
  })

  it('GET /api/devices matches additionalPhones on the sale/nasiya customer', () => {
    const source = read('src/lib/server/shop-lists.ts')
    expect(source).toMatch(/customer:\s*\{\s*additionalPhones:\s*\{\s*has:\s*searchDigits/)
  })

  it('GET /api/nasiya matches additionalPhones on the customer', () => {
    // See the note-field test above — logic now lives in shop-lists.ts.
    const source = read('src/lib/server/shop-lists.ts')
    expect(source).toMatch(/customer:\s*\{\s*additionalPhones:\s*\{\s*has:\s*searchDigits/)
  })
})
