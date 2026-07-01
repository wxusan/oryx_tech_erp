/**
 * GET /api/nasiya/[id] — get a single nasiya with full details
 *
 * Returns: customer, device, schedules ordered by monthNumber, shop
 * Auth: SHOP_ADMIN (scoped to their own shop) or SUPER_ADMIN
 */

import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireApiSession } from '@/lib/api-auth'
import { ok, notFound, serverError } from '@/lib/api-helpers'

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, ctx: RouteContext) {
  try {
    const guarded = await requireApiSession()
    if (!guarded.ok) return guarded.response
    const { session } = guarded

    const { id: nasiyaId } = await ctx.params

    const nasiya = await prisma.nasiya.findFirst({
      where: {
        id: nasiyaId,
        deletedAt: null,
        ...(session.user.role === 'SHOP_ADMIN' ? { shopId: session.user.shopId ?? '' } : {}),
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
        shop: true,
        schedules: { orderBy: { monthNumber: 'asc' } },
      },
    })

    if (!nasiya) return notFound('Nasiya topilmadi')

    return ok(nasiya, "Nasiya ma'lumotlari")
  } catch (err) {
    console.error('[GET /api/nasiya/[id]]', err)
    return serverError()
  }
}
