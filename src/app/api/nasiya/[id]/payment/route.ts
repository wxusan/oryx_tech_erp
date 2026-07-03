/**
 * POST /api/nasiya/[id]/payment — record a payment against a nasiya schedule entry
 *
 * [id] here is the nasiya ID (not schedule ID — the schedule to pay is in the body).
 *
 * Updates the NasiyaSchedule row, recalculates nasiya totals,
 * marks nasiya as COMPLETED if fully paid, creates a notification, and logs.
 */

import { NextRequest, after } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/generated/prisma/client'
import { requireApiSession, resolveActiveShopId } from '@/lib/api-auth'
import { addNasiyaPaymentSchema } from '@/lib/validations'
import { calculateRemaining } from '@/lib/nasiya-utils'
import { ok, badRequest, notFound, conflict, serverError } from '@/lib/api-helpers'
import { processPendingNotifications } from '@/lib/notification-service'
import { logger } from '@/lib/logger'
import { invalidateShopPaymentMutation } from '@/lib/server/cache-tags'
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
    const idempotencyKey = req.headers.get('idempotency-key')?.trim()
    if (amount > 0 && !idempotencyKey) {
      return badRequest('Idempotency-Key sarlavhasi kiritilishi shart')
    }

    const resolved = await resolveActiveShopId(session, (body as { shopId?: string }).shopId)
    if (!resolved.ok) return resolved.response
    const { shopId } = resolved
    const auditNote = note?.trim()

    const runPaymentTransaction = () => prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Verify nasiya exists and belongs to this shop
      const nasiya = await tx.nasiya.findFirst({
        where: { id: nasiyaId, shopId, deletedAt: null, status: { not: 'CANCELLED' } },
        include: { schedules: true },
      })
      if (!nasiya) throw { status: 404, message: "Nasiya topilmadi" }

      if (amount > 0 && idempotencyKey) {
        const existingPayment = await tx.nasiyaPayment.findUnique({
          where: { shopId_idempotencyKey: { shopId, idempotencyKey } },
        })
        if (existingPayment) {
          if (existingPayment.nasiyaId !== nasiyaId) {
            throw { status: 409, message: "Idempotency-Key boshqa nasiya to'lovi uchun ishlatilgan" }
          }
          return {
            nasiyaId,
            nasiyaScheduleId: existingPayment.nasiyaScheduleId,
            amount: Number(existingPayment.amount),
            remaining: Number(nasiya.remainingAmount),
            duplicate: true,
          }
        }
      }

      const selectedSchedule = await tx.nasiyaSchedule.findFirst({
        where: { id: nasiyaScheduleId, nasiyaId, shopId },
      })
      if (!selectedSchedule) throw { status: 404, message: "To'lov jadvali topilmadi" }
      if (deferredToNext) {
        const currentDue = selectedSchedule.delayedUntil ?? selectedSchedule.dueDate
        if (!delayedUntil || delayedUntil <= currentDue) {
          throw { status: 400, message: "Yangi to'lov sanasi hozirgi muddatdan keyin bo'lishi kerak" }
        }
      }

      const unpaidSchedules = [...nasiya.schedules]
        .filter((schedule) => {
          if (schedule.status === 'PAID') return false
          return Number(schedule.paidAmount) < Number(schedule.expectedAmount)
        })
      const selectedOutstanding = Math.max(
        0,
        Number(selectedSchedule.expectedAmount) - Number(selectedSchedule.paidAmount),
      )
      const allocationRows = [
        ...unpaidSchedules.filter((schedule) => schedule.id === selectedSchedule.id),
        ...unpaidSchedules
          .filter((schedule) => schedule.id !== selectedSchedule.id)
          .sort((left, right) => {
          const leftDue = left.delayedUntil ?? left.dueDate
          const rightDue = right.delayedUntil ?? right.dueDate
          return leftDue.getTime() - rightDue.getTime() || left.monthNumber - right.monthNumber
        }),
      ]

      const allocations: { scheduleId: string; amount: number; paidAfter: number }[] = []

      if (deferredToNext) {
        const updatedSchedule = await tx.nasiyaSchedule.updateMany({
          where: {
            id: nasiyaScheduleId,
            nasiyaId,
            shopId,
            paidAmount: selectedSchedule.paidAmount,
          },
          data: {
            status: 'DEFERRED',
            delayedUntil,
            deferredToNext: true,
            note: auditNote,
          },
        })
        if (updatedSchedule.count !== 1) {
          throw { status: 409, message: "To'lov bir vaqtda yangilangan, qayta urinib ko'ring" }
        }
      } else {
        if (selectedOutstanding <= 0) {
          throw { status: 409, message: "Tanlangan oy to'lovi allaqachon yopilgan" }
        }
        const totalOutstanding = allocationRows.reduce(
          (sum, schedule) => sum + Math.max(0, Number(schedule.expectedAmount) - Number(schedule.paidAmount)),
          0,
        )
        if (amount > totalOutstanding) {
          throw { status: 409, message: "To'lov qolgan nasiya summasidan oshib ketdi" }
        }

        let remainingPayment = amount
        for (const schedule of allocationRows) {
          if (remainingPayment <= 0) break
          const outstanding = Math.max(0, Number(schedule.expectedAmount) - Number(schedule.paidAmount))
          const applied = Math.min(remainingPayment, outstanding)
          const newPaidAmount = Number(schedule.paidAmount) + applied
          const isFullyPaid = newPaidAmount >= Number(schedule.expectedAmount)
          const isPartial = !isFullyPaid && newPaidAmount > 0
          const effectiveDueDate = schedule.delayedUntil ?? schedule.dueDate
          const isPastDue = effectiveDueDate < new Date()
          const nextStatus = isFullyPaid ? 'PAID' : isPastDue ? 'OVERDUE' : isPartial ? 'PARTIAL' : 'PENDING'

          const updatedSchedule = await tx.nasiyaSchedule.updateMany({
            where: {
              id: schedule.id,
              nasiyaId,
              shopId,
              paidAmount: schedule.paidAmount,
            },
            data: {
              paidAmount: newPaidAmount,
              status: nextStatus,
              paidAt: isFullyPaid ? date : null,
              paymentMethod,
              note: auditNote,
            },
          })
          if (updatedSchedule.count !== 1) {
            throw { status: 409, message: "To'lov bir vaqtda yangilangan, qayta urinib ko'ring" }
          }

          allocations.push({ scheduleId: schedule.id, amount: applied, paidAfter: newPaidAmount })
          remainingPayment -= applied
        }

        await tx.nasiyaPayment.create({
          data: {
            nasiyaId,
            nasiyaScheduleId: allocations.length === 1 ? allocations[0].scheduleId : null,
            shopId,
            amount,
            paymentMethod,
            paidAt: date,
            note: auditNote,
            idempotencyKey,
            createdBy: session.user.id,
          },
        })
      }

      // Recalculate nasiya totals
      const allSchedules = await tx.nasiyaSchedule.findMany({ where: { nasiyaId } })
      const totalPaid = allSchedules.reduce((sum: number, s: { paidAmount: unknown }) => sum + Number(s.paidAmount), 0)
      const remaining = calculateRemaining(Number(nasiya.finalNasiyaAmount), totalPaid)

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

      // Notify all active shop admins with a verified telegramId
      if (amount > 0) {
        const shopAdmins = await tx.shopAdmin.findMany({
          where: { shopId, deletedAt: null, isActive: true, telegramId: { not: '' }, telegramVerifiedAt: { not: null } },
        })
        for (const admin of shopAdmins) {
          await tx.notification.create({
            data: {
              shopId,
              type: 'PAYMENT_RECEIVED',
              message: `💰 To'lov qabul qilindi\n📱 Nasiya: ${nasiyaId}\n💵 ${amount.toLocaleString()} so'm`,
              telegramId: admin.telegramId!,
              scheduledAt: new Date(),
              relatedId: allocations.length === 1 ? allocations[0].scheduleId : nasiyaId,
              relatedType: allocations.length === 1 ? 'NasiyaSchedule' : 'Nasiya',
            },
          })
        }
      }

      await tx.log.create({
        data: {
          shopId,
          actorId: session.user.id,
          actorType: session.user.role as 'SUPER_ADMIN' | 'SHOP_ADMIN',
          action: 'PAYMENT',
          targetType: 'NasiyaSchedule',
          targetId: nasiyaScheduleId,
          newValue: { amount, paymentMethod, deferredToNext, allocations, auditReason: auditNote },
          note: auditNote,
        },
      })

      return { nasiyaId, nasiyaScheduleId, amount, remaining, allocations, duplicate: false }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })

    let result: Awaited<ReturnType<typeof runPaymentTransaction>> | undefined
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        result = await runPaymentTransaction()
        break
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034' && attempt < 2) {
          continue
        }
        throw err
      }
    }
    if (!result) return serverError()

    if (!result.duplicate) {
      invalidateShopPaymentMutation(shopId)
    }

    // Flush freshly-queued notifications after the response (non-blocking).
    // The rows are already committed, so cron is the backstop if this misses.
    after(() => processPendingNotifications().catch((e) => logger.warn('notification flush failed', { event: 'notification.flush_failed', error: e })))

    return ok(result, result.duplicate ? "To'lov allaqachon qabul qilingan" : "To'lov muvaffaqiyatli qabul qilindi")
  } catch (err: unknown) {
    if (typeof err === 'object' && err !== null && 'status' in err) {
      const e = err as { status: number; message: string }
      if (e.status === 400) return badRequest(e.message)
      if (e.status === 404) return notFound(e.message)
      if (e.status === 409) return conflict(e.message)
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return conflict("Idempotency-Key bo'yicha to'lov allaqachon yozilgan")
    }
    console.error('[POST /api/nasiya/[id]/payment]', err)
    return serverError()
  }
}
