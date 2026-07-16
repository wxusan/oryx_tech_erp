import { NextRequest } from 'next/server'
import { requireShopAnyPermission, resolveActiveShopId } from '@/lib/api-auth'
import { badRequest, ok, serverError } from '@/lib/api-helpers'
import { logger } from '@/lib/logger'
import { getSalesList } from '@/lib/server/sales-list'

export async function GET(request: NextRequest) {
  try {
    const guarded = await requireShopAnyPermission(['SALE_VIEW', 'SALE_EDIT', 'SALE_REMINDER_MANAGE'])
    if (!guarded.ok) return guarded.response
    const resolved = await resolveActiveShopId(guarded.session, request.nextUrl.searchParams.get('shopId'))
    if (!resolved.ok) return resolved.response

    const search = request.nextUrl.searchParams.get('search')?.trim() ?? ''
    if (search.length > 100) return badRequest('Qidiruv 100 ta belgidan oshmasligi kerak')
    const skip = Math.max(0, Number.parseInt(request.nextUrl.searchParams.get('skip') ?? '0', 10) || 0)
    const take = Math.max(1, Math.min(100, Number.parseInt(request.nextUrl.searchParams.get('take') ?? '25', 10) || 25))
    const data = await getSalesList({
      shopId: resolved.shopId,
      search,
      skip,
      take,
      includeOwnerFinancials: guarded.session.user.role === 'SUPER_ADMIN' || guarded.principal?.memberKind === 'SHOP_OWNER',
    })
    return ok(data, "Sotuvlar ro'yxati")
  } catch (error) {
    logger.error('[GET /api/sales]', { event: 'api.route_error', error })
    return serverError()
  }
}
