import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

/**
 * Static tenant-isolation scanner — no live DB is provisioned in this
 * environment (DATABASE_URL points at a shared/remote host and every
 * `prisma db push` / `migrate dev` invocation is blocked by
 * scripts/check-db-safety.mjs), so a real cross-shop integration test
 * (Shop A session hitting Shop B's row) cannot run here. See the doc
 * comment at the bottom of this file for the exact manual test to run
 * against a real (local) database before shipping.
 *
 * Every dynamic `[id]/route.ts` handler in this codebase follows one
 * fixed, audited pattern (confirmed across all ~35 routes in the Phase A
 * production-readiness audit, docs/audits/security-audit.md): the FIRST
 * Prisma read keyed on the URL's `[id]` param is a `findFirst`/`findUnique`
 * "gate" query whose `where` clause also includes `shopId` — if the row
 * belongs to another shop, the gate returns null and the route 404s before
 * any mutation happens. Every later `.update()`/`.delete()` call in the same
 * handler then operates on an ID pulled from that already-shop-verified row
 * (e.g. `existing.id`, `nasiya.id`, `existing.customerId`), never the raw
 * URL param again — so it inherits the gate's tenant check.
 *
 * This test asserts the gate itself: for every dynamic-ID route file NOT in
 * the SUPER_ADMIN-only allowlist below, the first `findFirst`/`findUnique`
 * call whose `where` references the route's id variable also includes
 * `shopId` in the same object literal.
 */

const SUPER_ADMIN_ONLY_SHOP_PRIMARY_KEY_ROUTES = new Set([
  // These operate on Shop.id itself (the shop IS the resource, not a
  // shopId-owned child of it) and are gated by requireSuperAdmin(), not
  // resolveActiveShopId() — confirmed below, not exempted blindly.
  'src/app/api/shops/[id]/route.ts',
  'src/app/api/shops/[id]/admins/route.ts',
  'src/app/api/shops/[id]/payment/route.ts',
])

const DYNAMIC_ID_ROUTES = [
  'src/app/api/customers/[id]/route.ts',
  'src/app/api/devices/[id]/nasiya/route.ts',
  'src/app/api/devices/[id]/restock/route.ts',
  'src/app/api/devices/[id]/return/route.ts',
  'src/app/api/devices/[id]/route.ts',
  'src/app/api/devices/[id]/sell/route.ts',
  'src/app/api/nasiya/[id]/payment/route.ts',
  'src/app/api/nasiya/[id]/settlement/route.ts',
  'src/app/api/nasiya/[id]/reminder/route.ts',
  'src/app/api/nasiya/[id]/route.ts',
  'src/app/api/olib-sotdim/[id]/pay/route.ts',
  'src/app/api/sales/[id]/payment/route.ts',
  'src/app/api/sales/[id]/route.ts',
  'src/app/api/shops/[id]/route.ts',
  'src/app/api/shops/[id]/admins/route.ts',
  'src/app/api/shops/[id]/payment/route.ts',
]

describe('every shop-owned dynamic [id] route gates its first lookup on shopId', () => {
  it('the route inventory below is not stale (sanity check on the file list itself)', () => {
    for (const file of DYNAMIC_ID_ROUTES) {
      expect(() => read(file)).not.toThrow()
    }
  })

  const shopOwnedRoutes = DYNAMIC_ID_ROUTES.filter((f) => !SUPER_ADMIN_ONLY_SHOP_PRIMARY_KEY_ROUTES.has(f))

  /** Extracts the text between a `where: {` and its matching closing brace, tolerating nested `{ ... }` (e.g. `shop: { status: ... }`). */
  function extractWhereBody(sourceFromCallStart: string): string | null {
    const startMatch = /where:\s*\{/.exec(sourceFromCallStart)
    if (!startMatch) return null
    let depth = 1
    let i = startMatch.index + startMatch[0].length
    const bodyStart = i
    while (i < sourceFromCallStart.length && depth > 0) {
      if (sourceFromCallStart[i] === '{') depth++
      else if (sourceFromCallStart[i] === '}') depth--
      i++
    }
    return sourceFromCallStart.slice(bodyStart, i - 1)
  }

  it.each(shopOwnedRoutes)('%s: first id-keyed findFirst/findUnique where clause includes shopId', (file) => {
    const source = read(file)

    // Walk every findFirst/findUnique call site in document order, extract
    // its where-clause body (brace-matched, so nested relation filters like
    // `shop: { status: 'ACTIVE' }` don't truncate the scan early), and check
    // the first one that filters on the route's `id` param.
    const callSitePattern = /\.(findFirst|findUnique)\w*\(/g
    let siteMatch: RegExpExecArray | null
    let foundIdGate = false

    while ((siteMatch = callSitePattern.exec(source)) !== null) {
      const rest = source.slice(siteMatch.index)
      const whereBody = extractWhereBody(rest)
      if (whereBody === null) continue
      const referencesId = /\bid\s*[,:]/.test(whereBody)
      if (!referencesId) continue

      foundIdGate = true
      expect(whereBody).toMatch(/\bshopId\b/)
      break
    }

    expect(foundIdGate).toBe(true)
  })

  it.each([...SUPER_ADMIN_ONLY_SHOP_PRIMARY_KEY_ROUTES])('%s: exempted only because it requires SUPER_ADMIN, not a shop session', (file) => {
    const source = read(file)
    expect(source).toContain('requireSuperAdmin')
  })
})

/**
 * MANUAL TENANT-ISOLATION TEST (run against a local dev database before
 * shipping — cannot run in this sandboxed environment):
 *
 * 1. Seed two shops, Shop A and Shop B, each with one SHOP_ADMIN, one
 *    Device, one Nasiya, one Customer.
 * 2. Log in as Shop A's admin. Attempt:
 *    a. GET  /api/devices/<Shop B device id>          -> expect 404
 *    b. PATCH/DELETE on that same device id            -> expect 404
 *    c. GET  /api/nasiya/<Shop B nasiya id>             -> expect 404
 *    d. POST /api/nasiya/<Shop B nasiya id>/payment     -> expect 404
 *    e. GET  /api/customers/<Shop B customer id>        -> expect 404
 *    f. GET  /api/logs?shopId=<Shop B id>                -> expect 403/forbidden
 *       (resolveActiveShopId forces a SHOP_ADMIN's own shopId regardless of
 *       any shopId query param they pass)
 * 3. Log in as a SUPER_ADMIN. Confirm the same Shop B resources ARE
 *    reachable (super admin cross-shop access is intentional, not a bug).
 * 4. Confirm no response body in step 2 leaks Shop B data (name, phone,
 *    amounts) even in the error payload.
 */
