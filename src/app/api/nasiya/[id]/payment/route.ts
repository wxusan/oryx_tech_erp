/**
 * POST /api/nasiya/[id]/payment — record a payment against a nasiya schedule entry
 *
 * [id] here is the nasiya ID (not schedule ID — the schedule to pay is in the body).
 *
 * Updates the NasiyaSchedule row, recalculates nasiya totals,
 * marks nasiya as COMPLETED if fully paid, creates a notification, and logs.
 */

import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/generated/prisma/client'
import { requireApiSession, resolveActiveShopId } from '@/lib/api-auth'
import { addNasiyaPaymentSchema } from '@/lib/validations'
import { calculateRemaining } from '@/lib/nasiya-utils'
import { ok, badRequest, notFound, conflict, serverError } from '@/lib/api-helpers'
import { processPendingNotifications } from '@/lib/notification-service'
import type { ZodError } from 'zod'

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const guarded = await requireApiSession()
    if (!guarded.ok) return guarded.response
    const { session } = guarded

    const { id: nasiyaId } = await ctx.params
    const body: unknown = await req.json()
    const parsed = addNasiyaPaymentSchema.safeParse(body)

    if (!parsed.success) {
      const firstError = (parsed.error as ZodError).issues[0]?.message ?? "Noto'g'ri ma'lumot"
      return badRequest(firstError)
    }

    const {
      nasiyaScheduleId,
      amount,
      paymentMethod,
      date,
      delayedUntil,
      note,
      deferredToNext,
    } = parsed.data

    const resolved = await resolveActiveShopId(session, (body as { shopId?: string }).shopId)
    if (!resolved.ok) return resolved.response
    const { shopId } = resolved

    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Verify nasiya exists and belongs to this shop
      const nasiya = await tx.nasiya.findFirst({
        where: { id: nasiyaId, shopId, deletedAt: null, status: { not: 'CANCELLED' } },
        include: { schedules: true },
      })
      if (!nasiya) throw { status: 404, message: "Nasiya topilmadi" }

      // Verify the schedule entry belongs to this nasiya
      const schedule = await tx.nasiyaSchedule.findFirst({
        where: { id: nasiyaScheduleId, nasiyaId, shopId },
      })
      if (!schedule) throw { status: 404, message: "To'lov jadvali topilmadi" }

      const newPaidAmount = Number(schedule.paidAmount) + amount
      if (newPaidAmount > Number(schedule.expectedAmount)) {
        throw { status: 409, message: "To'lov rejalashtirilgan summadan oshib ketdi" }
      }
      const isFullyPaid = newPaidAmount >= Number(schedule.expectedAmount)
      const isPartial = !isFullyPaid && newPaidAmount > 0
      const effectiveDueDate = delayedUntil ?? schedule.delayedUntil ?? schedule.dueDate
      const isPastDue = effectiveDueDate < new Date()
      const nextStatus = deferredToNext
        ? 'DEFERRED'
        : isFullyPaid
          ? 'PAID'
          : isPastDue
            ? 'OVERDUE'
            : isPartial
            ? 'PARTIAL'
            : 'PENDING'

      const updatedSchedule = await tx.nasiyaSchedule.updateMany({
        where: {
          id: nasiyaScheduleId,
          nasiyaId,
          shopId,
          paidAmount: schedule.paidAmount,
        },
        data: {
          paidAmount: newPaidAmount,
          status: nextStatus,
          paidAt: isFullyPaid ? date : null,
          paymentMethod,
          delayedUntil,
          deferredToNext: deferredToNext ?? false,
          note,
        },
      })
      if (updatedSchedule.count !== 1) {
        throw { status: 409, message: "To'lov bir vaqtda yangilangan, qayta urinib ko'ring" }
      }

      if (amount > 0) {
        await tx.nasiyaPayment.create({
          data: {
            nasiyaId,
            nasiyaScheduleId,
            shopId,
            amount,
            paymentMethod,
            paidAt: date,
            note,
            createdBy: session.user.id,
          },
        })
      }

      // Recalculate nasiya totals
      const allSchedules = await tx.nasiyaSchedule.findMany({ where: { nasiyaId } })
      const totalPaid = allSchedules.reduce((sum: number, s: { paidAmount: unknown }) => sum + Number(s.paidAmount), 0)
      const remaining = calculateRemaining(Number(nasiya.totalAmount) - Number(nasiya.downPayment), totalPaid)

      const allFullyPaid = allSchedules.every(
        (s: { status: string }) => s.status === 'PAID',
      )
      const hasOverdue = allSchedules.some((s) => {
        if (s.status === 'PAID') return false
        if (Number(s.paidAmount) >= Number(s.expectedAmount)) return false
        const due = s.delayedUntil ?? s.dueDate
        return due < new Date()
      })

      await tx.nasiya.update({
        where: { id: nasiyaId },
        data: {
          remainingAmount: remaining,
          status: allFullyPaid || remaining <= 0 ? 'COMPLETED' : hasOverdue ? 'OVERDUE' : 'ACTIVE',
        },
      })

      // Notify all active shop admins with a telegramId
      const shopAdmins = await tx.shopAdmin.findMany({
        where: { shopId, deletedAt: null, isActive: true, telegramId: { not: '' } },
      })
      for (const admin of shopAdmins) {
        await tx.notification.create({
          data: {
            shopId,
            type: 'PAYMENT_RECEIVED',
            message: `💰 To'lov qabul qilindi\n📱 Nasiya: ${nasiyaId}\n💵 ${amount.toLocaleString()} so'm`,
            telegramId: admin.telegramId!,
            scheduledAt: new Date(),
            relatedId: nasiyaScheduleId,
            relatedType: 'NasiyaSchedule',
          },
        })
      }

      await tx.log.create({
        data: {
          shopId,
          actorId: session.user.id,
          actorType: session.user.role as 'SUPER_ADMIN' | 'SHOP_ADMIN',
          action: 'PAYMENT',
          targetType: 'NasiyaSchedule',
          targetId: nasiyaScheduleId,
          newValue: { amount, paymentMethod, deferredToNext },
        },
      })

      return { nasiyaId, nasiyaScheduleId, amount, remaining }
    })

    await processPendingNotifications()

    return ok(result, "To'lov muvaffaqiyatli qabul qilindi")
  } catch (err: unknown) {
    if (typeof err === 'object' && err !== null && 'status' in err) {
      const e = err as { status: number; message: string }
      if (e.status === 404) return notFound(e.message)
      if (e.status === 409) return conflict(e.message)
    }
    console.error('[POST /api/nasiya/[id]/payment]', err)
    return serverError()
  }
}
