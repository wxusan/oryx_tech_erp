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
import { ok, serverError } from '@/lib/api-helpers'
import { requireApiSession } from '@/lib/api-auth'

export async function GET(req: NextRequest) {
  try {
    const guarded = await requireApiSession()
    if (!guarded.ok) return guarded.response
    const { session } = guarded

    const { searchParams } = req.nextUrl

    const requestedShopId = searchParams.get('shopId') ?? undefined
    const shopId = session.user.role === 'SHOP_ADMIN' ? session.user.shopId : requestedShopId
    const actorType = searchParams.get('actorType') ?? undefined
    const from = searchParams.get('from') ?? undefined
    const to = searchParams.get('to') ?? undefined
    const search = searchParams.get('search')?.trim()
    const requestedTake = Number(searchParams.get('take') ?? 50)
    const requestedSkip = Number(searchParams.get('skip') ?? 0)
    const take = Number.isFinite(requestedTake)
      ? Math.trunc(Math.min(Math.max(requestedTake, 1), 100))
      : 50
    const skip = Number.isFinite(requestedSkip)
      ? Math.trunc(Math.max(requestedSkip, 0))
      : 0

    const where: Prisma.LogWhereInput = {
      ...(shopId && shopId !== 'all' ? { shopId } : {}),
      ...(actorType && actorType !== 'barchasi' ? { actorType: actorType as 'SUPER_ADMIN' | 'SHOP_ADMIN' } : {}),
      ...(from || to
        ? {
            createdAt: {
              ...(from ? { gte: new Date(from) } : {}),
              ...(to ? { lte: new Date(to + 'T23:59:59.999Z') } : {}),
            },
          }
        : {}),
      ...(search
        ? {
            OR: [
              { action: { contains: search, mode: 'insensitive' } },
              { targetType: { contains: search, mode: 'insensitive' } },
              { targetId: { contains: search, mode: 'insensitive' } },
              { note: { contains: search, mode: 'insensitive' } },
              { shop: { name: { contains: search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    }

    const [logs, total] = await Promise.all([
      prisma.log.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: {
          shop: { select: { id: true, name: true } },
        },
      }),
      prisma.log.count({ where }),
    ])

    return ok({ logs, total, skip, take }, "Loglar ro'yxati")
  } catch (err) {
    console.error('[GET /api/logs]', err)
    return serverError()
  }
}
