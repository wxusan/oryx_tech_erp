/**
 * PATCH /api/nasiya/[id]/reminder — toggle a nasiya's payment reminder.
 *
 * Body: { reminderEnabled: boolean }
 * Auth: SHOP_ADMIN (scoped to their own shop) or SUPER_ADMIN.
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { requireApiSession } from '@/lib/api-auth'
import { ok, badRequest, notFound, serverError } from '@/lib/api-helpers'
import type { ZodError } from 'zod'

type RouteContext = { params: Promise<{ id: string }> }

const reminderSchema = z.object({
  reminderEnabled: z.boolean(),
})

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  try {
    const guarded = await requireApiSession()
    if (!guarded.ok) return guarded.response
    const { session } = guarded

    const { id: nasiyaId } = await ctx.params

    const body: unknown = await req.json().catch(() => null)
    const parsed = reminderSchema.safeParse(body)
    if (!parsed.success) {
      const firstError = (parsed.error as ZodError).issues[0]?.message ?? "Noto'g'ri ma'lumot"
      return badRequest(firstError)
    }
    const { reminderEnabled } = parsed.data

    const nasiya = await prisma.nasiya.findFirst({
      where: {
        id: nasiyaId,
        deletedAt: null,
        shop: { status: 'ACTIVE', deletedAt: null },
        ...(session.user.role === 'SHOP_ADMIN' ? { shopId: session.user.shopId ?? '' } : {}),
      },
      select: { id: true, shopId: true, reminderEnabled: true },
    })

    if (!nasiya) return notFound('Nasiya topilmadi')

    const updated = await prisma.nasiya.update({
      where: { id: nasiya.id },
      data: { reminderEnabled },
    })

    await prisma.log.create({
      data: {
        shopId: nasiya.shopId,
        actorId: session.user.id,
        actorType: session.user.role as 'SUPER_ADMIN' | 'SHOP_ADMIN',
        action: 'UPDATE_REMINDER',
        targetType: 'Nasiya',
        targetId: nasiya.id,
        oldValue: { reminderEnabled: nasiya.reminderEnabled },
        newValue: { reminderEnabled },
      },
    })

    return ok(updated, reminderEnabled ? 'Eslatma yoqildi' : "Eslatma o'chirildi")
  } catch (err) {
    console.error('[PATCH /api/nasiya/[id]/reminder]', err)
    return serverError()
  }
}
