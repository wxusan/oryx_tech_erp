import { type NextRequest } from 'next/server'
import { requireShopPermission, resolveActiveShopId } from '@/lib/api-auth'
import { badRequest, notFound, ok, serverError } from '@/lib/api-helpers'
import { parseCustomerProfileAnalyticsMonths } from '@/lib/customer-profile-analytics'
import { logger } from '@/lib/logger'
import { getCustomerProfileAnalytics } from '@/lib/server/customer-profile-analytics'

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, ctx: RouteContext) {
  try {
    const guarded = await requireShopPermission('CUSTOMER_VIEW')
    if (!guarded.ok) return guarded.response
    const resolved = await resolveActiveShopId(guarded.session, req.nextUrl.searchParams.get('shopId'))
    if (!resolved.ok) return resolved.response
    const months = parseCustomerProfileAnalyticsMonths(req.nextUrl.searchParams.get('months') ?? '12')
    if (!months) return badRequest('Davr faqat 6, 12 yoki 24 oy bo‘lishi mumkin')
    const { id } = await ctx.params
    const includeOwnerFinancials =
      guarded.session.user.role === 'SUPER_ADMIN' || guarded.principal?.memberKind === 'SHOP_OWNER'
    const analytics = await getCustomerProfileAnalytics({
      shopId: resolved.shopId,
      customerId: id,
      months,
      visibility: { includeOwnerFinancials },
    })
    if (!analytics) return notFound('Mijoz topilmadi')
    return ok(analytics, 'Mijoz tahlili')
  } catch (error) {
    logger.error('[GET /api/customers/[id]/analytics]', { event: 'api.route_error', error })
    return serverError("Mijoz tahlilini yuklab bo'lmadi")
  }
}
