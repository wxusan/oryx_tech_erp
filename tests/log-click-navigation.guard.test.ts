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

  it('is guarded by requireApiSession + resolveActiveShopId (tenant isolation)', () => {
    expect(source).toContain('requireApiSession()')
    expect(source).toContain('resolveActiveShopId(session')
  })

  it('every entity lookup filters by the resolved shopId, never targetId alone', () => {
    const lookups = source.match(/prisma\.\w+\.findFirst\(\{[\s\S]{0,120}?\}\)/g) ?? []
    expect(lookups.length).toBeGreaterThanOrEqual(6)
    for (const lookup of lookups) {
      expect(lookup).toContain('shopId')
    }
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

describe('logs page: rows are clickable and navigate via the resolved link', () => {
  const source = read('src/app/(shop)/shop/logs/logs-client.tsx')

  it('only Device/Nasiya/NasiyaSchedule/Sale/SupplierPayable rows are marked linkable', () => {
    expect(source).toContain("new Set(['Device', 'Nasiya', 'NasiyaSchedule', 'Sale', 'SupplierPayable'])")
  })

  it('clicking a row calls the link-resolution endpoint and navigates on success', () => {
    expect(source).toContain('fetch(`/api/logs/${log.id}/link`)')
    expect(source).toContain('router.push(json.data.href)')
  })

  it('a non-linkable row (or a resolution that returns no href) never navigates', () => {
    expect(source).toContain('if (!log.linkable || resolvingLogId) return')
  })

  it('a failed lookup is caught and does not crash the page', () => {
    const fnStart = source.indexOf('async function openLogTarget')
    const fn = source.slice(fnStart, fnStart + 700)
    expect(fn).toContain('catch')
  })
})
