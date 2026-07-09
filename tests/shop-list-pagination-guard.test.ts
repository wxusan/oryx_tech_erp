import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

/**
 * Production-readiness follow-up (superseding the earlier "hard cap +
 * truncation banner" version of this guard): the server-rendered
 * /shop/qurilmalar and /shop/nasiyalar list pages used to hardcode
 * `take: 500` with only a banner to signal an over-cap shop — rows past the
 * cap were still unreachable. Both pages now have REAL page/skip/take
 * pagination (matching the /api/logs and /api/customers envelope), so a
 * shop with any number of devices/nasiyalar can browse every row via
 * Prev/Next, with an accurate `total` from `prisma.*.count()` run with the
 * exact same `where` as the paginated `findMany`.
 */
describe('shop-lists.ts: getShopDevicesList/getShopNasiyalarList are real page/skip/take pagination', () => {
  const source = read('src/lib/server/shop-lists.ts')

  it('no more hard-cap-plus-one truncation-detection fetch', () => {
    expect(source).not.toContain('SHOP_LIST_HARD_CAP')
    expect(source).not.toMatch(/take:\s*500\b/)
    expect(source).not.toContain('truncated')
  })

  it('both getShopDevicesList and getShopNasiyalarList accept a query object and return {items, total, skip, take}', () => {
    expect(source).toMatch(/export interface ShopListPage<T>/)
    expect(source).toMatch(/total:\s*number/)
    expect(source).toMatch(/getShopDevicesList\(shopId: string, query: ShopDevicesQuery = \{\}\): Promise<ShopListPage<ShopDeviceListItem>>/)
    expect(source).toMatch(/getShopNasiyalarList\(shopId: string, query: ShopNasiyalarQuery = \{\}\): Promise<ShopListPage<ShopNasiyaListItem>>/)
  })

  it('both run count() with the exact same where clause as findMany, in parallel', () => {
    expect(source).toContain('prisma.device.count({ where })')
    expect(source).toContain('prisma.nasiya.count({ where })')
    const promiseAllMatches = source.match(/Promise\.all\(\[/g) ?? []
    expect(promiseAllMatches.length).toBeGreaterThanOrEqual(2)
  })

  it('page size is clamped to a real per-page size (default 25, max 100), not the old 500-row cap', () => {
    expect(source).toContain('const LIST_DEFAULT_TAKE = 25')
    expect(source).toContain('const LIST_MAX_TAKE = 100')
  })
})

describe('the qurilmalar/nasiyalar pages fetch only the first page server-side and hand off to client-fetch pagination', () => {
  it('qurilmalar page passes initialDevices/initialTotal (not the old truncated flag) to the client component', () => {
    const source = read('src/app/(shop)/shop/qurilmalar/page.tsx')
    expect(source).toMatch(/items:\s*devices,\s*total\s*}/)
    expect(source).toContain('initialDevices={devices}')
    expect(source).toContain('initialTotal={total}')
    expect(source).not.toContain('truncated')
  })

  it('qurilmalar client has real Prev/Next pagination, not a truncation banner', () => {
    const source = read('src/app/(shop)/shop/qurilmalar/qurilmalar-client.tsx')
    expect(source).not.toContain('truncated')
    expect(source).not.toMatch(/tadan oshib ketdi/)
    expect(source).toContain('disabled={page === 1}')
    expect(source).toContain('disabled={page === totalPages}')
  })

  it('nasiyalar page passes initialNasiyalar/initialTotal (not the old truncated flag) to the client component', () => {
    const source = read('src/app/(shop)/shop/nasiyalar/page.tsx')
    expect(source).toMatch(/items:\s*nasiyalar,\s*total\s*}/)
    expect(source).toContain('initialNasiyalar={nasiyalar}')
    expect(source).toContain('initialTotal={total}')
    expect(source).not.toContain('truncated')
  })

  it('nasiyalar client has real Prev/Next pagination, not a truncation banner', () => {
    const source = read('src/app/(shop)/shop/nasiyalar/nasiyalar-client.tsx')
    expect(source).not.toContain('truncated')
    expect(source).not.toMatch(/tadan oshib ketdi/)
    expect(source).toContain('disabled={page === 1}')
    expect(source).toContain('disabled={page === totalPages}')
  })
})

describe('the one genuinely unbounded query found by audit (super-admin shop list) now has a safety cap', () => {
  it('/api/stats/admin caps its Shop.findMany instead of leaving it unbounded', () => {
    const source = read('src/app/api/stats/admin/route.ts')
    expect(source).toMatch(/prisma\.shop\.findMany\(\{\s*\n\s*where:\s*\{[^}]*\},\s*\n\s*take:\s*\d+/)
  })
})
