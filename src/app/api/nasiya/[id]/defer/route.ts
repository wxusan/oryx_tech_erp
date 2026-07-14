import { NextRequest } from 'next/server'
import type { ZodError } from 'zod'
import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { requireShopPermissionAndFeature, resolveActiveShopId } from '@/lib/api-auth'
import { deferNasiyaScheduleSchema } from '@/lib/validations'
import { deriveContractNasiyaStatus } from '@/lib/nasiya-contract-status'
import { badRequest, conflict, notFound, ok, serverError, tooManyRequests } from '@/lib/api-helpers'
import { invalidateShopNasiyaMutation } from '@/lib/server/cache-tags'
import { isRetryableTransactionError } from '@/lib/server/transaction-retry'
import { checkRateLimitDistributed } from '@/lib/rate-limit-adapter'
import { rateLimitKey } from '@/lib/rate-limit'
import { sameInstant, sameOptionalText } from '@/lib/idempotency-replay'
import { logger } from '@/lib/logger'

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const guarded = await requireShopPermissionAndFeature('NASIYA_MANAGE', 'NASIYA')
    if (!guarded.ok) return guarded.response
    const { session } = guarded

    const { id: nasiyaId } = await ctx.params
    const body: unknown = await req.json()
    const parsed = deferNasiyaScheduleSchema.safeParse(body)
    if (!parsed.success) {
      const message = (parsed.error as ZodError).issues[0]?.message ?? "Noto'g'ri ma'lumot"
      return badRequest(message)
    }

    const idempotencyKey = req.headers.get('idempotency-key')?.trim()
    if (!idempotencyKey) return badRequest('Idempotency-Key sarlavhasi kiritilishi shart')

    const resolved = await resolveActiveShopId(session, (body as { shopId?: string }).shopId)
    if (!resolved.ok) return resolved.response
    const { shopId } = resolved
    const rate = await checkRateLimitDistributed(
      rateLimitKey('nasiya-defer', shopId, session.user.id),
      { windowMs: 60_000, max: 20 },
    )
    if (!rate.allowed) return tooManyRequests(rate.retryAfterSeconds)

    const { nasiyaScheduleId, newDueDate, reason } = parsed.data
    const run = () => prisma.$transaction(async (tx) => {
      const existing = await tx.nasiyaDeferral.findUnique({
        where: { shopId_idempotencyKey: { shopId, idempotencyKey } },
      })
      if (existing) {
        if (
          existing.nasiyaId !== nasiyaId
          || existing.nasiyaScheduleId !== nasiyaScheduleId
          || !sameInstant(existing.newDueDate, newDueDate)
          || !sameOptionalText(existing.note, reason)
        ) {
          throw {
            status: 409,
            message: "Idempotency-Key boshqa yoki o'zgartirilgan kechiktirish amali uchun ishlatilgan",
          }
        }
        return {
          id: existing.id,
          nasiyaId,
          nasiyaScheduleId,
          originalDueDate: existing.originalDueDate,
          newDueDate: existing.newDueDate,
          duplicate: true,
        }
      }

      await tx.$queryRaw(Prisma.sql`
        SELECT "id" FROM "Nasiya"
        WHERE "id" = ${nasiyaId} AND "shopId" = ${shopId}
        FOR UPDATE
      `)
      const nasiya = await tx.nasiya.findFirst({
        where: { id: nasiyaId, shopId, deletedAt: null },
        include: { schedules: true },
      })
      if (!nasiya) throw { status: 404, message: 'Nasiya topilmadi' }
      if (nasiya.resolutionState !== 'ACTIVE') {
        throw { status: 409, message: "Arxivlangan yoki hisobdan chiqarilgan nasiya avval qayta ochilishi kerak" }
      }
      if (nasiya.status === 'CANCELLED') throw { status: 409, message: 'Bekor qilingan nasiya kechiktirilmaydi' }

      const derived = deriveContractNasiyaStatus({
        status: nasiya.status,
        contractCurrency: nasiya.contractCurrency,
        contractFinalAmount: Number(nasiya.contractFinalAmount),
        contractRemainingAmount: Number(nasiya.contractRemainingAmount),
        schedules: nasiya.schedules.map((schedule) => ({
          status: schedule.status,
          dueDate: schedule.dueDate,
          delayedUntil: schedule.delayedUntil,
          expectedAmount: Number(schedule.expectedAmount),
          paidAmount: Number(schedule.paidAmount),
          contractExpectedAmount: Number(schedule.contractExpectedAmount),
          contractPaidAmount: Number(schedule.contractPaidAmount),
        })),
      })
      if (derived.displayStatus === 'COMPLETED') throw { status: 409, message: 'Yakunlangan nasiya kechiktirilmaydi' }

      await tx.$queryRaw(Prisma.sql`
        SELECT "id" FROM "NasiyaSchedule"
        WHERE "id" = ${nasiyaScheduleId}
          AND "nasiyaId" = ${nasiyaId}
          AND "shopId" = ${shopId}
        FOR UPDATE
      `)
      const schedule = await tx.nasiyaSchedule.findFirst({
        where: { id: nasiyaScheduleId, nasiyaId, shopId },
      })
      if (!schedule) throw { status: 404, message: "To'lov jadvali topilmadi" }
      if (['PAID', 'CANCELLED'].includes(schedule.status)) {
        throw { status: 409, message: "Yopilgan to'lov jadvali kechiktirilmaydi" }
      }
      const originalDueDate = schedule.delayedUntil ?? schedule.dueDate
      if (newDueDate <= originalDueDate) {
        throw { status: 400, message: "Yangi to'lov sanasi hozirgi muddatdan keyin bo'lishi kerak" }
      }

      await tx.nasiyaSchedule.update({
        where: { id: schedule.id },
        data: {
          status: 'DEFERRED',
          delayedUntil: newDueDate,
          deferredToNext: true,
          note: reason ?? null,
        },
      })
      const event = await tx.nasiyaDeferral.create({
        data: {
          shopId,
          nasiyaId,
          nasiyaScheduleId,
          originalDueDate,
          newDueDate,
          delayedUntil: newDueDate,
          note: reason ?? null,
          idempotencyKey,
          createdBy: session.user.id,
          createdByType: session.user.role as 'SUPER_ADMIN' | 'SHOP_ADMIN',
        },
      })
      await tx.log.create({
        data: {
          shopId,
          actorId: session.user.id,
          actorType: session.user.role as 'SUPER_ADMIN' | 'SHOP_ADMIN',
          action: 'NASIYA_DEFER',
          targetType: 'NasiyaSchedule',
          targetId: nasiyaScheduleId,
          oldValue: { dueDate: originalDueDate.toISOString() },
          newValue: {
            deferralEventId: event.id,
            oldDueDate: originalDueDate.toISOString(),
            newDueDate: newDueDate.toISOString(),
            auditReason: reason ?? null,
          },
          note: reason ?? null,
        },
      })
      return {
        id: event.id,
        nasiyaId,
        nasiyaScheduleId,
        originalDueDate,
        newDueDate,
        duplicate: false,
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })

    let result: Awaited<ReturnType<typeof run>> | undefined
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        result = await run()
        break
      } catch (error) {
        if (isRetryableTransactionError(error) && attempt < 2) continue
        throw error
      }
    }
    if (!result) return serverError()
    if (!result.duplicate) invalidateShopNasiyaMutation(shopId)
    return ok(result, result.duplicate ? 'Kechiktirish avval yozilgan' : "To'lov muddati uzaytirildi")
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && 'status' in error) {
      const typed = error as { status: number; message: string }
      if (typed.status === 400) return badRequest(typed.message)
      if (typed.status === 404) return notFound(typed.message)
      if (typed.status === 409) return conflict(typed.message)
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return conflict("Idempotency-Key bo'yicha kechiktirish allaqachon yozilgan")
    }
    logger.error('[POST /api/nasiya/[id]/defer]', { event: 'api.route_error', error })
    return serverError()
  }
}
