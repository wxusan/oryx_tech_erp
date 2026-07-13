import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

/**
 * Item 8 — clicking a log row opens the related sale/nasiya/device profile.
 * GET /api/logs/[id]/link resolves the log's targetType+targetId to a
 * shop-scoped href (never another shop's data — every lookup filters by the
 * resolved shopId). Missing/deleted targets and target types with no
 * detail page (Customer, Shop, ShopAdmin, ...) resolve to `href: null`
 * instead of throwing, so a log row can never crash the page.
 */
describe('GET /api/logs/[id]/link resolves each target type to a shop-scoped href', () => {
  const source = read('src/app/api/logs/[id]/link/route.ts')

  it('is guarded by the live log permission + resolveActiveShopId (tenant isolation)', () => {
    expect(source).toContain("requireShopPermission('LOG_VIEW')")
    expect(source).toContain('resolveActiveShopId(session')
  })

  it('every entity lookup filters by the resolved shopId, never targetId alone', () => {
    const lookups = source.match(/prisma\.\w+\.findFirst\(\{[\s\S]{0,120}?\}\)/g) ?? []
    // Five target resolvers are compact enough for this source extraction;
    // the initial Log lookup is formatted over multiple lines below.
    expect(lookups.length).toBeGreaterThanOrEqual(5)
    for (const lookup of lookups) {
      expect(lookup).toContain('shopId')
    }
    expect(source).toContain('id: logId,\n        shopId,')
  })

  it('resolves Device -> qurilmalar profile, Nasiya -> nasiyalar profile', () => {
    expect(source).toContain("return device ? `/shop/qurilmalar/${device.id}` : null")
    expect(source).toContain("return nasiya ? `/shop/nasiyalar/${nasiya.id}` : null")
  })

  it('resolves NasiyaSchedule via its parent nasiyaId, and Sale via its parent deviceId (targetId is not the URL id directly)', () => {
    expect(source).toContain("return schedule ? `/shop/nasiyalar/${schedule.nasiyaId}` : null")
    expect(source).toContain("return sale ? `/shop/qurilmalar/${sale.deviceId}` : null")
  })

  it('unknown/no-detail-page target types (Customer, Shop, ShopAdmin, ...) resolve to null, not a crash', () => {
    expect(source).toContain('default:')
    const defaultBlockStart = source.lastIndexOf('default:')
    expect(source.slice(defaultBlockStart, defaultBlockStart + 300)).toContain('return null')
  })

  it('a log row not found in this shop returns notFound, never leaks whether it exists in another shop', () => {
    expect(source).toContain("if (!log) return notFound(")
  })
})

describe('logs page: rows are real, directly navigable links', () => {
  const source = read('src/app/(shop)/shop/logs/logs-client.tsx')
  const apiSource = read('src/app/api/logs/route.ts')
  const initialSource = read('src/lib/server/shop-lists.ts')
  const linkSource = read('src/lib/server/log-links.ts')

  it('uses a focusable StretchedLink instead of a click-only table row', () => {
    expect(source).toContain("import { StretchedLink } from '@/components/ui/stretched-link'")
    expect(source).toContain('<StretchedLink')
    expect(source).toContain('href={log.href}')
    expect(source).not.toContain('onClick={() => openLogTarget(log)}')
  })

  it('returns server-resolved hrefs for both the initial payload and paginated API payload', () => {
    expect(apiSource).toContain('resolveShopLogTargetHrefs(shopId, logs)')
    expect(apiSource).toContain('href: hrefs.get(shopLogTargetKey(log)) ?? null')
    expect(initialSource).toContain('resolveShopLogTargetHrefs(shopId, logs)')
    expect(initialSource).toContain('href: hrefs.get(shopLogTargetKey(log)) ?? null')
  })

  it('uses bounded, tenant-scoped batch queries instead of an N+1 client lookup', () => {
    expect(linkSource).toContain('resolveShopLogTargetHrefs')
    expect(linkSource).toContain('where: { shopId, id: { in: deviceIds } }')
    expect(linkSource).toContain('where: { shopId, id: { in: nasiyaIds } }')
    expect(linkSource).toContain('where: { shopId, id: { in: scheduleIds } }')
    expect(linkSource).toContain('where: { shopId, id: { in: saleIds } }')
  })
})
