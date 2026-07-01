/**
 * GET /api/logs?shopId=...&actorType=...&from=...&to=...
 *
 * Super admin only. Returns logs with server-side pagination.
 * All query params are optional filters.
 */

import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { ok, serverError } from '@/lib/api-helpers'
import { requireSuperAdmin } from '@/lib/api-auth'

export async function GET(req: NextRequest) {
  try {
    const guarded = await requireSuperAdmin()
    if (!guarded.ok) return guarded.response

    const { searchParams } = req.nextUrl

    const shopId = searchParams.get('shopId') ?? undefined
    const actorType = searchParams.get('actorType') ?? undefined
    const from = searchParams.get('from') ?? undefined
    const to = searchParams.get('to') ?? undefined
    const take = Math.min(Math.max(Number(searchParams.get('take') ?? 50), 1), 100)
    const skip = Math.max(Number(searchParams.get('skip') ?? 0), 0)

    const where = {
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
