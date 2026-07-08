import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

/**
 * Item 1 — filter/sort stats by admin where admin attribution exists. The
 * shop-level "stats" surface with real per-action admin attribution is the
 * Logs page (Log.actorId is set on every row); the month-based date range
 * filter already existed (dateFrom/dateTo). Full month/admin breakdowns on
 * the /shop/hisobot dashboard itself would require reworking a
 * heavily-tested, business-critical accounting engine
 * (src/lib/server/shop-stats.ts, hardcoded to the current month) — left
 * deferred, documented in docs/product-feature-fixes.md, not faked here.
 */
describe('GET /api/logs supports filtering by admin (actorId) — real attribution, not invented', () => {
  const source = read('src/app/api/logs/route.ts')

  it('reads an actorId query param and applies it to the where clause', () => {
    expect(source).toContain("const actorId = searchParams.get('actorId')?.trim()")
    expect(source).toContain('...(actorId ? { actorId } : {})')
  })
})

describe('logs page: admin filter dropdown built from real seen actors', () => {
  const source = read('src/app/(shop)/shop/logs/logs-client.tsx')

  it('builds options from Log.actorId/actorName already returned by the API, never a hardcoded list', () => {
    expect(source).toContain('knownActors')
    expect(source).toContain('map.set(log.actorId,')
  })

  it('accumulates actors across every page loaded (not just the current page)', () => {
    expect(source).toContain('setKnownActors((prev) => {')
    expect(source).toContain('const next = new Map(prev)')
  })

  it('selecting an admin resets to page 1 and includes actorId in the request', () => {
    expect(source).toContain("if (actorId) params.set('actorId', actorId)")
    expect(source).toContain('setActorId(e.target.value); setPage(1)')
  })
})
