import { NextRequest } from 'next/server'
import { requireShopPermission, resolveActiveShopId } from '@/lib/api-auth'
import { forbidden, notFound, ok, serverError } from '@/lib/api-helpers'
import { logger } from '@/lib/logger'
import {
  CUSTOMER_PROFILE_SECTIONS,
  getCustomerProfileHistory,
  getCustomerProfileOverview,
  type CustomerProfileSection,
} from '@/lib/server/customer-profile'

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, ctx: RouteContext) {
  try {
    const guarded = await requireShopPermission('CUSTOMER_VIEW')
    if (!guarded.ok) return guarded.response
    const resolved = await resolveActiveShopId(guarded.session, req.nextUrl.searchParams.get('shopId'))
    if (!resolved.ok) return resolved.response
    const { id } = await ctx.params
    const requestedSection = req.nextUrl.searchParams.get('section')
    const section = CUSTOMER_PROFILE_SECTIONS.includes(requestedSection as CustomerProfileSection)
      ? requestedSection as CustomerProfileSection
      : 'devices'
    const includeOwnerFinancials =
      guarded.session.user.role === 'SUPER_ADMIN' || guarded.principal?.memberKind === 'SHOP_OWNER'
    // Resolution events include immutable write-off/archive monetary context;
    // they are an owner-only audit surface, not an operational staff queue.
    if (!includeOwnerFinancials && section === 'resolutions') {
      return forbidden("Hisobdan chiqarish va arxiv tarixi faqat do'kon egasiga ochiq")
    }
    const requestedPage = Number(req.nextUrl.searchParams.get('page') ?? 1)
    const page = Number.isFinite(requestedPage) ? Math.max(1, Math.trunc(requestedPage)) : 1

    const overview = await getCustomerProfileOverview({
      shopId: resolved.shopId,
      customerId: id,
      visibility: { includeOwnerFinancials },
    })
    if (!overview) return notFound('Mijoz topilmadi')
    const history = await getCustomerProfileHistory({
      shopId: resolved.shopId,
      customerId: id,
      section,
      page,
      take: 20,
    })

    return ok({ overview, section, history }, 'Mijoz profili')
  } catch (error) {
    logger.error('[GET /api/customers/[id]/profile]', { event: 'api.route_error', error })
    return serverError("Mijoz profilini yuklab bo'lmadi")
  }
}
