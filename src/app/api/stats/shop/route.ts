/**
 * GET /api/stats/shop?shopId=... — shop dashboard statistics
 *
 * Auth: SHOP_ADMIN (auto-scoped to their shop) or SUPER_ADMIN (shopId param required)
 * Returns: totalDevices, soldThisMonth, activeNasiyalar, expectedThisMonth,
 *          overdueCount, recentActivity, upcomingPayments
 */

import { NextRequest } from 'next/server'
import { requireApiSession, resolveActiveShopId } from '@/lib/api-auth'
import { ok, serverError } from '@/lib/api-helpers'
import { getShopStats } from '@/lib/server/shop-stats'

export async function GET(req: NextRequest) {
  try {
    const guarded = await requireApiSession()
    if (!guarded.ok) return guarded.response
    const { session } = guarded

    const { searchParams } = req.nextUrl

    const resolved = await resolveActiveShopId(session, searchParams.get('shopId'))
    if (!resolved.ok) return resolved.response
    const { shopId } = resolved

    return ok(await getShopStats(session, shopId))
  } catch (err) {
    console.error('[GET /api/stats/shop]', err)
    return serverError()
  }
}
