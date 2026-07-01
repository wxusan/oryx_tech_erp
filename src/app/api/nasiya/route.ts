/**
 * GET /api/nasiya?shopId=...&status=... — list nasiyalar
 *
 * Auth: SHOP_ADMIN (scoped to their own shop) or SUPER_ADMIN (requires shopId param)
 * Returns nasiyalar with customer + device + _count schedules + schedules ordered by monthNumber
 */

import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireApiSession } from '@/lib/api-auth'
import { ok, badRequest, serverError } from '@/lib/api-helpers'

export async function GET(req: NextRequest) {
  try {
    const guarded = await requireApiSession()
    if (!guarded.ok) return guarded.response
    const { session } = guarded

    const { searchParams } = req.nextUrl

    const shopId =
      session.user.role === 'SUPER_ADMIN'
        ? (searchParams.get('shopId') ?? undefined)
        : (session.user.shopId ?? undefined)

    if (!shopId) {
      return badRequest('shopId talab qilinadi')
    }

    const status = searchParams.get('status') ?? undefined
    const search = searchParams.get('search')?.trim()

    const nasiyalar = await prisma.nasiya.findMany({
      where: {
        shopId,
        deletedAt: null,
        ...(status ? { status: status as 'ACTIVE' | 'COMPLETED' | 'OVERDUE' | 'CANCELLED' } : {}),
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
    })

    const sorted = nasiyalar.sort((a, b) => {
      const nextA = a.schedules
        .filter((s) => ['PENDING', 'PARTIAL', 'OVERDUE', 'DEFERRED'].includes(s.status))
        .sort((left, right) => left.dueDate.getTime() - right.dueDate.getTime())[0]
      const nextB = b.schedules
        .filter((s) => ['PENDING', 'PARTIAL', 'OVERDUE', 'DEFERRED'].includes(s.status))
        .sort((left, right) => left.dueDate.getTime() - right.dueDate.getTime())[0]

      if (!nextA && !nextB) return b.createdAt.getTime() - a.createdAt.getTime()
      if (!nextA) return 1
      if (!nextB) return -1
      return nextA.dueDate.getTime() - nextB.dueDate.getTime()
    })

    return ok(sorted, "Nasiyalar ro'yxati")
  } catch (err) {
    console.error('[GET /api/nasiya]', err)
    return serverError()
  }
}
