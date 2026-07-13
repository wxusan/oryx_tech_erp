/**
 * GET /api/nasiya?shopId=...&status=...&search=...&skip=...&take=... — paginated nasiyalar list
 *
 * Auth: SHOP_ADMIN (scoped to their own shop) or SUPER_ADMIN (requires shopId param)
 * Returns { items, total, skip, take }, the same canonical bounded envelope as
 * /api/devices, /api/logs and /api/customers.
 *
 * The actual query/derivation/scoring logic lives in
 * `getShopNasiyalarList` (src/lib/server/shop-lists.ts) — reused as-is so the
 * list page's server-rendered first page and this client-fetch route never
 * drift apart.
 */

import { NextRequest } from 'next/server'
import { requireShopPermission, resolveActiveShopId } from '@/lib/api-auth'
import { ok, badRequest, serverError } from '@/lib/api-helpers'
import { logger } from '@/lib/logger'
import { getShopNasiyalarList, type NasiyaStatusFilter } from '@/lib/server/shop-lists'

const nasiyaStatuses = ['ACTIVE', 'COMPLETED', 'OVERDUE', 'CANCELLED'] as const

export async function GET(req: NextRequest) {
  try {
    const guarded = await requireShopPermission('NASIYA_VIEW')
    if (!guarded.ok) return guarded.response
    const { session } = guarded

    const { searchParams } = req.nextUrl

    const resolved = await resolveActiveShopId(session, searchParams.get('shopId'))
    if (!resolved.ok) return resolved.response
    const { shopId } = resolved

    const statusParam = searchParams.get('status') ?? undefined
    if (statusParam && !nasiyaStatuses.includes(statusParam as (typeof nasiyaStatuses)[number])) {
      return badRequest("Nasiya statusi noto'g'ri")
    }
    const status = statusParam as NasiyaStatusFilter | undefined
    const search = searchParams.get('search')?.trim()
    const requestedTake = Number(searchParams.get('take') ?? 25)
    const requestedSkip = Number(searchParams.get('skip') ?? 0)
    const take = Number.isFinite(requestedTake) ? Math.trunc(Math.min(Math.max(requestedTake, 1), 100)) : 25
    const skip = Number.isFinite(requestedSkip) ? Math.trunc(Math.max(requestedSkip, 0)) : 0

    const { items, total } = await getShopNasiyalarList(shopId, { search, status, skip, take })

    return ok({ items, total, skip, take }, "Nasiyalar ro'yxati")
  } catch (err) {
    logger.error('[GET /api/nasiya]', { event: 'api.route_error', error: err })
    return serverError()
  }
}
