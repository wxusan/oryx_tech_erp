import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

/**
 * Real page/skip/take pagination for the devices (qurilmalar) list,
 * replacing the old single fetch capped at SHOP_LIST_HARD_CAP (500) rows
 * with a "truncated" banner and no way to reach hidden rows. Mirrors
 * tests/mijozlar-pagination.guard.test.ts.
 */
describe('GET /api/devices: opt-in paginated envelope, existing plain-array consumers untouched', () => {
  const route = read('src/app/api/devices/route.ts')

  it('only returns {items, total, skip, take} when ?paginated=1 is present', () => {
    expect(route).toContain("searchParams.get('paginated') === '1'")
    expect(route).toContain('ok({ items, total, skip, take }')
  })

  it('the paginated branch delegates to getShopDevicesList (shared with the SSR first page)', () => {
    expect(route).toContain('getShopDevicesList(shopId, {')
  })

  it('the non-paginated (default) mode is untouched: still returns the plain devices array', () => {
    expect(route).toContain("return ok(devices, \"Qurilmalar ro'yxati\")")
  })
})

describe('shop-lists.ts getShopDevicesList: search/status/skip/take/total', () => {
  const source = read('src/lib/server/shop-lists.ts')

  it('accepts search/status/skip/take and counts with the same where as findMany', () => {
    expect(source).toContain('export interface ShopDevicesQuery')
    expect(source).toContain('prisma.device.count({ where })')
  })

  it('search matches IMEI/model/color/storage/note/supplier phone/customer name+phone (same OR clause as GET /api/devices)', () => {
    expect(source).toContain("{ imei: { contains: search, mode: 'insensitive' as const } }")
    expect(source).toContain("{ supplier: { phone: { contains: search, mode: 'insensitive' as const } } }")
  })
})

describe('qurilmalar page/client: page state, total, and pagination controls', () => {
  const page = read('src/app/(shop)/shop/qurilmalar/page.tsx')
  const client = read('src/app/(shop)/shop/qurilmalar/qurilmalar-client.tsx')

  it('page fetches only the first page server-side and forwards initialDevices/initialTotal', () => {
    expect(page).toContain('initialDevices={devices}')
    expect(page).toContain('initialTotal={total}')
  })

  it('client has page state and resets to page 1 when the search or status filter changes', () => {
    expect(client).toContain('const [page, setPage] = useState(1)')
    expect(client).toContain("setSearch(e.target.value); setPage(1)")
    expect(client).toContain('setActiveStatus(tab.value); setPage(1)')
  })

  it('renders Prev/Next controls gated on the real total, disabled at the boundaries', () => {
    expect(client).toContain('disabled={page === 1}')
    expect(client).toContain('disabled={page === totalPages}')
  })

  it('no more client-side devices.filter()/matchesDeviceSearch — filtering is server-side now', () => {
    expect(client).not.toContain('matchesDeviceSearch')
    expect(client).not.toContain('devices.filter(')
  })
})

describe('qurilmalar client: mobile card view alongside the desktop table', () => {
  const client = read('src/app/(shop)/shop/qurilmalar/qurilmalar-client.tsx')

  it('desktop table is hidden below sm:, shown from sm: up', () => {
    expect(client).toContain('hidden sm:block border border-zinc-200 rounded overflow-x-auto')
  })

  it('a separate card list is shown only below sm:, with a directly-visible Ko\'rish link (not an overflow menu)', () => {
    expect(client).toContain('sm:hidden space-y-3')
    const mobileBlockStart = client.indexOf('sm:hidden space-y-3')
    const mobileBlock = client.slice(mobileBlockStart, mobileBlockStart + 2000)
    expect(mobileBlock).toContain("Ko&apos;rish")
    expect(mobileBlock).toContain('displayImei(d.imei)')
  })
})
