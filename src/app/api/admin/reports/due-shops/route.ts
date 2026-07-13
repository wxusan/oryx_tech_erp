/**
 * GET /api/admin/reports/due-shops?skip=0&take=12
 *
 * Authoritative, bounded subscription-due projection for the super-admin
 * report. The exact same active/non-deleted filter is used for the page and
 * total, and the id tie-breaker makes pagination stable when shops share a
 * due date.
 */

import type { NextRequest } from 'next/server'
import { ok, serverError } from '@/lib/api-helpers'
import { requireSuperAdmin } from '@/lib/api-auth'
import { logger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'

const DEFAULT_TAKE = 12
const MAX_TAKE = 100

function boundedInteger(value: string | null, fallback: number, minimum: number, maximum?: number) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  const integer = Math.trunc(parsed)
  return Math.min(Math.max(integer, minimum), maximum ?? Number.MAX_SAFE_INTEGER)
}

export async function GET(req: NextRequest) {
  try {
    const guarded = await requireSuperAdmin()
    if (!guarded.ok) return guarded.response

    const skip = boundedInteger(req.nextUrl.searchParams.get('skip'), 0, 0)
    const take = boundedInteger(req.nextUrl.searchParams.get('take'), DEFAULT_TAKE, 1, MAX_TAKE)
    const where = { status: 'ACTIVE' as const, deletedAt: null }

    const [items, total] = await Promise.all([
      prisma.shop.findMany({
        where,
        orderBy: [{ subscriptionDue: 'asc' }, { id: 'asc' }],
        skip,
        take,
        select: {
          id: true,
          name: true,
          ownerName: true,
          shopNumber: true,
          subscriptionDue: true,
          _count: {
            select: {
              devices: { where: { deletedAt: null } },
              nasiya: { where: { deletedAt: null, status: { not: 'CANCELLED' } } },
            },
          },
        },
      }),
      prisma.shop.count({ where }),
    ])

    return ok({ items, total, skip, take }, "To'lov muddati bo'yicha do'konlar")
  } catch (err) {
    logger.error('[GET /api/admin/reports/due-shops]', { event: 'api.route_error', error: err })
    return serverError()
  }
}
