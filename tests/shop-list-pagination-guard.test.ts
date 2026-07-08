import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

/**
 * Production-readiness follow-up: the server-rendered /shop/qurilmalar and
 * /shop/nasiyalar list pages used to hardcode `take: 500` with no signal to
 * the admin when a shop actually had more rows than that (older rows were
 * silently hidden). This doesn't build full skip/take pagination UI (a much
 * larger change against two pages with only client-side search) — instead
 * it fetches one extra row to detect the over-cap case and surfaces a
 * `truncated` flag through to a visible banner, so data loss is visible
 * instead of silent. Full paginated browsing of shops with 500+
 * devices/nasiyalar remains a documented follow-up
 * (docs/audits/full-production-audit.md).
 */
describe('shop-lists.ts caps devices/nasiyalar queries and reports truncation instead of hiding it silently', () => {
  const source = read('src/lib/server/shop-lists.ts')

  it('defines a single named hard cap constant, not a magic number repeated at each call site', () => {
    expect(source).toMatch(/export const SHOP_LIST_HARD_CAP\s*=\s*500/)
    expect(source).not.toMatch(/take:\s*500\b/)
  })

  it('both list queries fetch one row past the cap to detect truncation', () => {
    const takeMatches = source.match(/take:\s*SHOP_LIST_HARD_CAP\s*\+\s*1/g) ?? []
    expect(takeMatches.length).toBeGreaterThanOrEqual(2)
  })

  it('both getShopDevicesList and getShopNasiyalarList return a truncated flag', () => {
    expect(source).toMatch(/export interface ShopListResult<T>/)
    expect(source).toMatch(/truncated:\s*boolean/)
    expect(source).toMatch(/getShopDevicesList\(shopId: string\): Promise<ShopListResult<ShopDeviceListItem>>/)
    expect(source).toMatch(/getShopNasiyalarList\(shopId: string\): Promise<ShopListResult<ShopNasiyaListItem>>/)
  })
})

describe('the truncation flag reaches the page and is rendered as a visible banner', () => {
  it('qurilmalar page destructures truncated and forwards it to the client component', () => {
    const source = read('src/app/(shop)/shop/qurilmalar/page.tsx')
    expect(source).toMatch(/items:\s*devices,\s*truncated\s*}/)
    expect(source).toContain('truncated={truncated}')
  })

  it('qurilmalar client renders a truncation banner', () => {
    const source = read('src/app/(shop)/shop/qurilmalar/qurilmalar-client.tsx')
    expect(source).toContain('truncated')
    expect(source).toMatch(/tadan oshib ketdi/)
  })

  it('nasiyalar page destructures truncated and forwards it to the client component', () => {
    const source = read('src/app/(shop)/shop/nasiyalar/page.tsx')
    expect(source).toMatch(/items:\s*nasiyalar,\s*truncated\s*}/)
    expect(source).toContain('truncated={truncated}')
  })

  it('nasiyalar client renders a truncation banner', () => {
    const source = read('src/app/(shop)/shop/nasiyalar/nasiyalar-client.tsx')
    expect(source).toContain('truncated')
    expect(source).toMatch(/tadan oshib ketdi/)
  })
})

describe('the one genuinely unbounded query found by audit (super-admin shop list) now has a safety cap', () => {
  it('/api/stats/admin caps its Shop.findMany instead of leaving it unbounded', () => {
    const source = read('src/app/api/stats/admin/route.ts')
    expect(source).toMatch(/prisma\.shop\.findMany\(\{\s*\n\s*where:\s*\{[^}]*\},\s*\n\s*take:\s*\d+/)
  })
})
