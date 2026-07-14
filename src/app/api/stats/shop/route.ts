/**
 * GET /api/stats/shop?shopId=... — shop dashboard statistics
 *
 * Auth: SHOP_ADMIN (auto-scoped to their shop) or SUPER_ADMIN (shopId param required)
 * Returns: totalDevices, soldThisMonth, activeNasiyalar, expectedThisMonth,
 *          overdueCount, recentActivity, upcomingPayments
 */

import { NextRequest } from 'next/server'
import { requireShopAnyPermission, resolveActiveShopId } from '@/lib/api-auth'
import { ok, serverError } from '@/lib/api-helpers'
import { getShopOperationalStats, getShopStats } from '@/lib/server/shop-stats'
import { logger } from '@/lib/logger'
import { principalHasPermission } from '@/lib/server/shop-access'

export async function GET(req: NextRequest) {
  try {
    const guarded = await requireShopAnyPermission(['DASHBOARD_OPERATIONAL_VIEW', 'DASHBOARD_FINANCIAL_VIEW', 'REPORT_VIEW'])
    if (!guarded.ok) return guarded.response
    const { session } = guarded

    const { searchParams } = req.nextUrl

    const resolved = await resolveActiveShopId(session, searchParams.get('shopId'))
    if (!resolved.ok) return resolved.response
    const { shopId } = resolved

    const monthKey = searchParams.get('month')?.trim() || null
    const adminId = searchParams.get('admin')?.trim() || null
    const financialView = session.user.role === 'SUPER_ADMIN' || Boolean(
      guarded.principal && (
        principalHasPermission(guarded.principal, 'DASHBOARD_FINANCIAL_VIEW') ||
        principalHasPermission(guarded.principal, 'REPORT_VIEW')
      ),
    )
    const stats = financialView
      ? await getShopStats(session, shopId, { monthKey, adminId })
      : await getShopOperationalStats(session, shopId)
    return ok(stats)
  } catch (err) {
    logger.error('[GET /api/stats/shop]', { event: 'api.route_error', error: err })
    return serverError()
  }
}
