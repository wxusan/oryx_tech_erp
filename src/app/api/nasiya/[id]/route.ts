/**
 * GET   /api/nasiya/[id] — get a single nasiya with full details
 * PATCH /api/nasiya/[id] — edit SAFE nasiya fields only (note).
 *
 * Financial terms (finalNasiyaAmount, remainingAmount, paidAmount, schedule
 * amounts, interestPercent, downPayment, months) are NOT editable here — they
 * would rewrite money/payment history. Correcting those requires a dedicated
 * correction flow (future work). Reminder toggling lives in ./reminder.
 *
 * Auth: SHOP_ADMIN (scoped to their own shop) or SUPER_ADMIN
 */

import { NextRequest } from 'next/server'
import { z, ZodError } from 'zod'
import { prisma } from '@/lib/prisma'
import { requireApiSession } from '@/lib/api-auth'
import { ok, badRequest, notFound, serverError } from '@/lib/api-helpers'
import { invalidateShopReminderMutation } from '@/lib/server/cache-tags'

type RouteContext = { params: Promise<{ id: string }> }

const updateNasiyaSchema = z.object({
  note: z.string().trim().max(1000, "Izoh 1000 belgidan oshmasligi kerak").optional(),
})

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
        baseRemainingAmount: true,
        interestPercent: true,
        interestAmount: true,
        finalNasiyaAmount: true,
        remainingAmount: true,
        status: true,
        reminderEnabled: true,
        note: true,
        isImported: true,
        importSource: true,
        importedAt: true,
        originalSaleDate: true,
        originalTotalAmount: true,
        alreadyPaidBeforeImport: true,
        remainingAtImport: true,
        importNote: true,
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
            delayedUntil: true,
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

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  try {
    const guarded = await requireApiSession()
    if (!guarded.ok) return guarded.response
    const { session } = guarded

    const { id: nasiyaId } = await ctx.params
    const body: unknown = await req.json()
    const parsed = updateNasiyaSchema.safeParse(body)
    if (!parsed.success) {
      const firstError = (parsed.error as ZodError).issues[0]?.message ?? "Noto'g'ri ma'lumot"
      return badRequest(firstError)
    }
    if (parsed.data.note === undefined) {
      return badRequest("O'zgartirish uchun ma'lumot kiritilmadi")
    }

    const existing = await prisma.nasiya.findFirst({
      where: {
        id: nasiyaId,
        deletedAt: null,
        shop: { status: 'ACTIVE', deletedAt: null },
        ...(session.user.role === 'SHOP_ADMIN' ? { shopId: session.user.shopId ?? '' } : {}),
      },
      select: { id: true, shopId: true, note: true },
    })
    if (!existing) return notFound('Nasiya topilmadi')

    const updated = await prisma.$transaction(async (tx) => {
      const nasiya = await tx.nasiya.update({
        where: { id: existing.id },
        data: { note: parsed.data.note },
        select: { id: true, note: true },
      })
      await tx.log.create({
        data: {
          shopId: existing.shopId,
          actorId: session.user.id,
          actorType: session.user.role as 'SUPER_ADMIN' | 'SHOP_ADMIN',
          action: 'UPDATE',
          targetType: 'Nasiya',
          targetId: existing.id,
          oldValue: { note: existing.note },
          newValue: { note: parsed.data.note },
        },
      })
      return nasiya
    })

    invalidateShopReminderMutation(existing.shopId)

    return ok(updated, 'Nasiya izohi yangilandi')
  } catch (err) {
    console.error('[PATCH /api/nasiya/[id]]', err)
    return serverError()
  }
}
