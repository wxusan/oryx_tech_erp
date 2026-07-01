/**
 * GET /api/nasiya?shopId=...&status=... — list nasiyalar
 *
 * Auth: SHOP_ADMIN (scoped to their own shop) or SUPER_ADMIN (requires shopId param)
 * Returns nasiyalar with customer + device + _count schedules + schedules ordered by monthNumber
 */

import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireApiSession, resolveActiveShopId } from '@/lib/api-auth'
import { ok, badRequest, serverError } from '@/lib/api-helpers'

const nasiyaStatuses = ['ACTIVE', 'COMPLETED', 'OVERDUE', 'CANCELLED'] as const

export async function GET(req: NextRequest) {
  try {
    const guarded = await requireApiSession()
    if (!guarded.ok) return guarded.response
    const { session } = guarded

    const { searchParams } = req.nextUrl

    const resolved = await resolveActiveShopId(session, searchParams.get('shopId'))
    if (!resolved.ok) return resolved.response
    const { shopId } = resolved

    const statusParam = searchParams.get('status') ?? undefined
    if (statusParam && !nasiyaStatuses.includes(statusParam as (typeof nasiyaStatuses)[number])) {
      return badRequest("Nasiya statusi noto'g'ri")
    }
    const status = statusParam as (typeof nasiyaStatuses)[number] | undefined
    const search = searchParams.get('search')?.trim()
    const requestedTake = Number(searchParams.get('take') ?? 200)
    const requestedSkip = Number(searchParams.get('skip') ?? 0)
    const take = Number.isFinite(requestedTake) ? Math.trunc(Math.min(Math.max(requestedTake, 1), 500)) : 200
    const skip = Number.isFinite(requestedSkip) ? Math.trunc(Math.max(requestedSkip, 0)) : 0

    const nasiyalar = await prisma.nasiya.findMany({
      where: {
        shopId,
        deletedAt: null,
        ...(status ? { status } : {}),
        ...(search
          ? {
              OR: [
                { customer: { name: { contains: search, mode: 'insensitive' } } },
                { customer: { phone: { contains: search, mode: 'insensitive' } } },
                { device: { model: { contains: search, mode: 'insensitive' } } },
                { device: { imei: { contains: search, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      include: {
        customer: {
          select: {
            id: true,
            shopId: true,
            name: true,
            phone: true,
            note: true,
            createdAt: true,
          },
        },
        device: true,
        schedules: { orderBy: { monthNumber: 'asc' } },
        _count: { select: { schedules: true } },
      },
      take,
      skip,
    })

    const sorted = nasiyalar.sort((a, b) => {
      const nextA = a.schedules
        .filter((s) => ['PENDING', 'PARTIAL', 'OVERDUE', 'DEFERRED'].includes(s.status))
        .sort((left, right) => {
          const leftDue = left.delayedUntil ?? left.dueDate
          const rightDue = right.delayedUntil ?? right.dueDate
          return leftDue.getTime() - rightDue.getTime()
        })[0]
      const nextB = b.schedules
        .filter((s) => ['PENDING', 'PARTIAL', 'OVERDUE', 'DEFERRED'].includes(s.status))
        .sort((left, right) => {
          const leftDue = left.delayedUntil ?? left.dueDate
          const rightDue = right.delayedUntil ?? right.dueDate
          return leftDue.getTime() - rightDue.getTime()
        })[0]

      if (!nextA && !nextB) return b.createdAt.getTime() - a.createdAt.getTime()
      if (!nextA) return 1
      if (!nextB) return -1
      return (nextA.delayedUntil ?? nextA.dueDate).getTime() - (nextB.delayedUntil ?? nextB.dueDate).getTime()
    })

    return ok(sorted, "Nasiyalar ro'yxati")
  } catch (err) {
    console.error('[GET /api/nasiya]', err)
    return serverError()
  }
}
