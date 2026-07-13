/**
 * GET /api/stats/shop?shopId=... — shop dashboard statistics
 *
 * Auth: SHOP_ADMIN (auto-scoped to their shop) or SUPER_ADMIN (shopId param required)
 * Returns: totalDevices, soldThisMonth, activeNasiyalar, expectedThisMonth,
 *          overdueCount, recentActivity, upcomingPayments
 */

import { NextRequest } from 'next/server'
import { requireShopPermission, resolveActiveShopId } from '@/lib/api-auth'
import { ok, serverError } from '@/lib/api-helpers'
import { getShopStats } from '@/lib/server/shop-stats'
import { logger } from '@/lib/logger'

export async function GET(req: NextRequest) {
  try {
    const guarded = await requireShopPermission('REPORT_VIEW')
    if (!guarded.ok) return guarded.response
    const { session } = guarded

    const { searchParams } = req.nextUrl

    const resolved = await resolveActiveShopId(session, searchParams.get('shopId'))
    if (!resolved.ok) return resolved.response
    const { shopId } = resolved

    const monthKey = searchParams.get('month')?.trim() || null
    const adminId = searchParams.get('admin')?.trim() || null
    return ok(await getShopStats(session, shopId, { monthKey, adminId }))
  } catch (err) {
    logger.error('[GET /api/stats/shop]', { event: 'api.route_error', error: err })
    return serverError()
  }
}
