/**
 * GET /api/nasiya/[id] — get a single nasiya with full details
 *
 * Returns: customer, device, schedules and payments needed by the nasiya profile
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
        shop: { status: 'ACTIVE', deletedAt: null },
        ...(session.user.role === 'SHOP_ADMIN' ? { shopId: session.user.shopId ?? '' } : {}),
      },
      select: {
        id: true,
        shopId: true,
        totalAmount: true,
        downPayment: true,
        remainingAmount: true,
        status: true,
        reminderEnabled: true,
        customer: {
          select: {
            id: true,
            name: true,
            phone: true,
            // Included so the nasiya profile page can render the passport photo.
            // Access is already shop-scoped (this nasiya is fetched only for its
            // owning shop) and the signed URL is separately per-shop authorized.
            passportPhotoUrl: true,
          },
        },
        device: {
          select: {
            id: true,
            model: true,
          },
        },
        schedules: {
          orderBy: { monthNumber: 'asc' },
          select: {
            id: true,
            monthNumber: true,
            dueDate: true,
            expectedAmount: true,
            paidAmount: true,
            status: true,
          },
        },
        payments: {
          where: { deletedAt: null },
          orderBy: { paidAt: 'desc' },
          select: {
            id: true,
            amount: true,
            paymentMethod: true,
            paidAt: true,
            note: true,
            nasiyaScheduleId: true,
          },
        },
      },
    })

    if (!nasiya) return notFound('Nasiya topilmadi')

    return ok(nasiya, "Nasiya ma'lumotlari")
  } catch (err) {
    console.error('[GET /api/nasiya/[id]]', err)
    return serverError()
  }
}
