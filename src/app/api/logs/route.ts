/**
 * GET /api/logs?shopId=...&actorType=...&from=...&to=...&search=...
 *
 * Super admins can view all logs. Shop admins are scoped to their own shop.
 * Returns logs with server-side pagination.
 * All query params are optional filters.
 */

import { NextRequest } from 'next/server'
import type { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { badRequest, ok, serverError } from '@/lib/api-helpers'
import { requireShopPermission } from '@/lib/api-auth'
import { enrichLogsWithActors } from '@/lib/server/log-actors'
import { resolveShopLogTargetHrefs, shopLogTargetKey } from '@/lib/server/log-links'
import { isLogCategory, logCategoryWhere } from '@/lib/log-categories'
import { redactShopStaffLogValue } from '@/lib/log-financial-redaction'
import { logger } from '@/lib/logger'

function parseDateParam(value: string | null | undefined, endOfDay = false) {
  if (!value) return null
  const date = new Date(endOfDay ? `${value}T23:59:59.999Z` : value)
  return Number.isNaN(date.getTime()) ? null : date
}

export async function GET(req: NextRequest) {
  try {
    const guarded = await requireShopPermission('LOG_VIEW')
    if (!guarded.ok) return guarded.response
    const { session } = guarded
    const isShopStaff =
      session.user.role === 'SHOP_ADMIN' && guarded.principal?.memberKind === 'SHOP_STAFF'

    const { searchParams } = req.nextUrl

    const requestedShopId = searchParams.get('shopId') ?? undefined
    const shopId = session.user.role === 'SHOP_ADMIN' ? session.user.shopId : requestedShopId
    // Shop admins only ever see their own shop-admin activity. Super-admin
    // (platform) actions are never exposed to them, even if actorType is
    // hand-crafted in the query string.
    const actorType = session.user.role === 'SHOP_ADMIN'
      ? 'SHOP_ADMIN'
      : (searchParams.get('actorType') ?? undefined)
    const from = searchParams.get('from') ?? undefined
    const to = searchParams.get('to') ?? undefined
    const search = searchParams.get('search')?.trim()
    const categoryParam = searchParams.get('category')?.trim()
    const targetIds = searchParams
      .getAll('targetId')
      .flatMap((value) => value.split(','))
      .map((value) => value.trim())
      .filter(Boolean)
    const targetType = searchParams.get('targetType')?.trim()
    // Item 1 — filter by the admin who performed the action. Real
    // attribution: Log.actorId is set on every row already (never faked).
    const actorId = searchParams.get('actorId')?.trim()
    const requestedTake = Number(searchParams.get('take') ?? 50)
    const requestedSkip = Number(searchParams.get('skip') ?? 0)
    const take = Number.isFinite(requestedTake)
      ? Math.trunc(Math.min(Math.max(requestedTake, 1), 100))
      : 50
    const skip = Number.isFinite(requestedSkip)
      ? Math.trunc(Math.max(requestedSkip, 0))
      : 0
    const fromDate = parseDateParam(from)
    const toDate = parseDateParam(to, true)
    if ((from && !fromDate) || (to && !toDate)) {
      return badRequest("Sana formati noto'g'ri")
    }
    if (categoryParam && !isLogCategory(categoryParam)) {
      return badRequest("Log kategoriyasi noto'g'ri")
    }
    const category = isLogCategory(categoryParam) ? categoryParam : 'all'
    const categoryWhere = logCategoryWhere(category)
    const searchWhere: Prisma.LogWhereInput = search
      ? {
          OR: [
            { action: { contains: search, mode: 'insensitive' } },
            { targetType: { contains: search, mode: 'insensitive' } },
            { targetId: { contains: search, mode: 'insensitive' } },
            { note: { contains: search, mode: 'insensitive' } },
            { shop: { name: { contains: search, mode: 'insensitive' } } },
          ],
        }
      : {}

    const where: Prisma.LogWhereInput = {
      ...(shopId && shopId !== 'all' ? { shopId } : {}),
      // Keep legacy restock audit events for platform administrators, while
      // never returning them in a shop-facing list, filter, count, or cache.
      ...(session.user.role === 'SHOP_ADMIN'
        ? { NOT: { action: 'RESTOCK', targetType: 'Device' } }
        : {}),
      ...(actorType && actorType !== 'barchasi' ? { actorType: actorType as 'SUPER_ADMIN' | 'SHOP_ADMIN' } : {}),
      ...(actorId ? { actorId } : {}),
      ...(targetType ? { targetType } : {}),
      ...(targetIds.length > 0 ? { targetId: { in: targetIds } } : {}),
      ...(from || to
        ? {
            createdAt: {
              ...(fromDate ? { gte: fromDate } : {}),
              ...(toDate ? { lte: toDate } : {}),
            },
          }
        : {}),
      ...(Object.keys(categoryWhere).length > 0 || Object.keys(searchWhere).length > 0
        ? { AND: [categoryWhere, searchWhere].filter((item) => Object.keys(item).length > 0) }
        : {}),
    }

    const [logs, total] = await Promise.all([
      prisma.log.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        select: {
          id: true,
          createdAt: true,
          actorId: true,
          actorType: true,
          action: true,
          targetType: true,
          targetId: true,
          note: true,
          newValue: true,
          shop: { select: { id: true, name: true } },
        },
      }),
      prisma.log.count({ where }),
    ])

    const [logsWithActors, hrefs] = await Promise.all([
      enrichLogsWithActors(logs),
      shopId && shopId !== 'all'
        ? resolveShopLogTargetHrefs(shopId, logs)
        : Promise.resolve(new Map<string, string>()),
    ])

    return ok({
      logs: logsWithActors.map((log) => ({
        ...log,
        ...(isShopStaff ? { newValue: redactShopStaffLogValue(log.newValue) } : {}),
        href: hrefs.get(shopLogTargetKey(log)) ?? null,
      })),
      total,
      skip,
      take,
    }, "Loglar ro'yxati")
  } catch (err) {
    logger.error('[GET /api/logs]', { event: 'api.route_error', error: err })
    return serverError()
  }
}
