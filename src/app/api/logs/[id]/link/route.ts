/**
 * GET /api/logs/[id]/link — resolve a log row's related profile URL (item 8).
 *
 * The log's own targetId is not always the URL id directly (e.g. a
 * NasiyaSchedule payment log's targetId is the SCHEDULE's id, not its
 * parent nasiya), so this does one small shop-scoped lookup to find the
 * actual page to link to. Returns `{ href: null }` — never an error — when
 * there is nothing to link to (no detail page for that entity, or the
 * target row no longer exists), so a log row can always render safely
 * instead of crashing or guessing.
 *
 * Every lookup below is scoped to the resolved shopId, so a log row can
 * never resolve to another shop's device/nasiya/sale — even though the log
 * itself was already confirmed to belong to this shop.
 */

import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireShopPermission, resolveActiveShopId } from '@/lib/api-auth'
import { ok, notFound, serverError } from '@/lib/api-helpers'
import { logger } from '@/lib/logger'

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, ctx: RouteContext) {
  try {
    const guarded = await requireShopPermission('LOG_VIEW')
    if (!guarded.ok) return guarded.response
    const { session } = guarded

    const { id: logId } = await ctx.params
    const { searchParams } = req.nextUrl
    const resolved = await resolveActiveShopId(session, searchParams.get('shopId'))
    if (!resolved.ok) return resolved.response
    const { shopId } = resolved

    const log = await prisma.log.findFirst({
      where: {
        id: logId,
        shopId,
        ...(session.user.role === 'SHOP_ADMIN'
          ? { NOT: { action: 'RESTOCK', targetType: 'Device' } }
          : {}),
      },
      select: { targetType: true, targetId: true },
    })
    if (!log) return notFound('Log topilmadi')

    const href = await resolveHref(log.targetType, log.targetId, shopId)
    return ok({ href })
  } catch (err) {
    logger.error('[GET /api/logs/[id]/link]', { event: 'api.route_error', error: err })
    return serverError()
  }
}

async function resolveHref(targetType: string, targetId: string, shopId: string): Promise<string | null> {
  switch (targetType) {
    case 'Device': {
      const device = await prisma.device.findFirst({ where: { id: targetId, shopId }, select: { id: true } })
      return device ? `/shop/qurilmalar/${device.id}` : null
    }
    case 'Nasiya': {
      const nasiya = await prisma.nasiya.findFirst({ where: { id: targetId, shopId }, select: { id: true } })
      return nasiya ? `/shop/nasiyalar/${nasiya.id}` : null
    }
    case 'NasiyaSchedule': {
      const schedule = await prisma.nasiyaSchedule.findFirst({ where: { id: targetId, shopId }, select: { nasiyaId: true } })
      return schedule ? `/shop/nasiyalar/${schedule.nasiyaId}` : null
    }
    case 'Sale': {
      const sale = await prisma.sale.findFirst({ where: { id: targetId, shopId }, select: { deviceId: true } })
      return sale ? `/shop/qurilmalar/${sale.deviceId}` : null
    }
    case 'SupplierPayable': {
      const payable = await prisma.supplierPayable.findFirst({ where: { id: targetId, shopId }, select: { id: true } })
      // No per-row olib-sotdim detail page exists yet — link to the list.
      return payable ? '/shop/olib-sotdim' : null
    }
    default:
      // Customer, Shop, ShopAdmin, CurrencyRate, SuperAdmin, Database — no
      // shop-facing detail page exists for these; the row renders with no
      // link (disabled state) rather than a broken/guessed URL.
      return null
  }
}
