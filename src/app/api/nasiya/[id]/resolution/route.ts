import { NextRequest } from 'next/server'
import type { ZodError } from 'zod'
import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { requireShopAnyPermission, resolveActiveShopId } from '@/lib/api-auth'
import { principalHasPermission } from '@/lib/server/shop-access'
import { resolveNasiyaSchema } from '@/lib/validations'
import { badRequest, conflict, forbidden, notFound, ok, serverError, tooManyRequests } from '@/lib/api-helpers'
import { invalidateShopNasiyaMutation } from '@/lib/server/cache-tags'
import { isRetryableTransactionError } from '@/lib/server/transaction-retry'
import { checkRateLimitDistributed } from '@/lib/rate-limit-adapter'
import { rateLimitKey } from '@/lib/rate-limit'
import { getUsdUzsRate } from '@/lib/server/currency'
import { logger } from '@/lib/logger'

type RouteContext = { params: Promise<{ id: string }> }
type ResolutionAction = 'ARCHIVE' | 'REOPEN'

const targetState = {
  ARCHIVE: 'ARCHIVED',
  REOPEN: 'ACTIVE',
} as const

const auditAction = {
  ARCHIVE: 'NASIYA_ARCHIVE',
  REOPEN: 'NASIYA_REOPEN',
} as const

function roundUzsContext(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function validTransition(action: ResolutionAction, state: 'ACTIVE' | 'ARCHIVED' | 'WRITTEN_OFF') {
  if (action === 'ARCHIVE') return state === 'ACTIVE'
  return state === 'ARCHIVED'
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const guarded = await requireShopAnyPermission(['NASIYA_ARCHIVE', 'NASIYA_REOPEN'])
    if (!guarded.ok) return guarded.response
    const { session } = guarded

    const { id: nasiyaId } = await ctx.params
    const body: unknown = await req.json()
    const parsed = resolveNasiyaSchema.safeParse(body)
    if (!parsed.success) {
      const message = (parsed.error as ZodError).issues[0]?.message ?? "Noto'g'ri ma'lumot"
      return badRequest(message)
    }
    const requiredPermission = auditAction[parsed.data.action]
    if (
      session.user.role !== 'SUPER_ADMIN' &&
      (!guarded.principal || !principalHasPermission(guarded.principal, requiredPermission))
    ) {
      return forbidden("Bu nasiya holati amali uchun ruxsat berilmagan")
    }
    const idempotencyKey = req.headers.get('idempotency-key')?.trim()
    if (!idempotencyKey) return badRequest('Idempotency-Key sarlavhasi kiritilishi shart')

    const resolved = await resolveActiveShopId(session, (body as { shopId?: string }).shopId)
    if (!resolved.ok) return resolved.response
    const { shopId } = resolved
    const rateLimit = await checkRateLimitDistributed(
      rateLimitKey('nasiya-resolution', shopId, session.user.id),
      { windowMs: 60_000, max: 12 },
    )
    if (!rateLimit.allowed) return tooManyRequests(rateLimit.retryAfterSeconds)

    const { action, reason } = parsed.data
    const currencySnapshot = await prisma.nasiya.findFirst({
      where: { id: nasiyaId, shopId, deletedAt: null },
      select: { contractCurrency: true },
    })
    if (!currencySnapshot) return notFound('Nasiya topilmadi')
    let frozenUsdUzsRate = 1
    if (action !== 'REOPEN' && currencySnapshot.contractCurrency === 'USD') {
      try {
        frozenUsdUzsRate = await getUsdUzsRate()
      } catch (error) {
        return badRequest(error instanceof Error ? error.message : 'USD kursi mavjud emas')
      }
    }

    const run = () => prisma.$transaction(async (tx) => {
      const replay = await tx.nasiyaResolutionEvent.findUnique({
        where: { shopId_idempotencyKey: { shopId, idempotencyKey } },
      })
      if (replay) {
        if (replay.nasiyaId !== nasiyaId || replay.eventType !== action || replay.reason !== reason) {
          throw {
            status: 409,
            message: "Idempotency-Key boshqa yoki o'zgartirilgan qarz holati amali uchun ishlatilgan",
          }
        }
        return { ...replay, duplicate: true }
      }

      await tx.$queryRaw(Prisma.sql`
        SELECT "id" FROM "Nasiya"
        WHERE "id" = ${nasiyaId} AND "shopId" = ${shopId}
        FOR UPDATE
      `)
      const nasiya = await tx.nasiya.findFirst({
        where: { id: nasiyaId, shopId, deletedAt: null },
      })
      if (!nasiya) throw { status: 404, message: 'Nasiya topilmadi' }
      if (nasiya.status === 'CANCELLED') throw { status: 409, message: 'Bekor qilingan nasiya holati o\'zgartirilmaydi' }
      if (!validTransition(action, nasiya.resolutionState)) {
        throw { status: 409, message: "Nasiya hozirgi holatidan bu amalga o'tkazilmaydi" }
      }

      const nativeRemainingAmount = Number(nasiya.contractRemainingAmount)
      const reversed = action === 'REOPEN'
        ? await tx.nasiyaResolutionEvent.findFirst({
            where: { shopId, nasiyaId, newState: nasiya.resolutionState },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          })
        : null
      if (action === 'REOPEN' && !reversed) {
        throw { status: 409, message: "Qayta ochish uchun oldingi arxiv/yopish hodisasi topilmadi" }
      }

      // A compensating reopen reverses the exact historic snapshot. It must
      // not revalue the write-off/archive at today's FX rate.
      const eventCurrency = reversed?.contractCurrency ?? nasiya.contractCurrency
      const eventNativeRemainingAmount = reversed
        ? Number(reversed.nativeRemainingAmount)
        : nativeRemainingAmount
      const eventFrozenUsdUzsRate = reversed
        ? Number(reversed.frozenUsdUzsRate)
        : frozenUsdUzsRate
      const frozenUzsAmount = reversed
        ? Number(reversed.frozenUzsAmount)
        : roundUzsContext(
            nasiya.contractCurrency === 'USD'
              ? nativeRemainingAmount * frozenUsdUzsRate
              : nativeRemainingAmount,
          )
      const newState = targetState[action]
      const event = await tx.nasiyaResolutionEvent.create({
        data: {
          shopId,
          nasiyaId,
          eventType: action,
          previousState: nasiya.resolutionState,
          newState,
          contractCurrency: eventCurrency,
          nativeRemainingAmount: eventNativeRemainingAmount,
          frozenUzsAmount,
          frozenUsdUzsRate: eventFrozenUsdUzsRate,
          reason,
          actorId: session.user.id,
          actorType: session.user.role as 'SUPER_ADMIN' | 'SHOP_ADMIN',
          idempotencyKey,
          reversesEventId: reversed?.id,
        },
      })
      await tx.nasiya.update({
        where: { id: nasiyaId },
        data: { resolutionState: newState, resolutionUpdatedAt: event.createdAt },
      })
      await tx.log.create({
        data: {
          shopId,
          actorId: session.user.id,
          actorType: session.user.role as 'SUPER_ADMIN' | 'SHOP_ADMIN',
          action: auditAction[action],
          targetType: 'Nasiya',
          targetId: nasiyaId,
          oldValue: { resolutionState: nasiya.resolutionState },
          newValue: {
            resolutionEventId: event.id,
            resolutionState: newState,
            contractCurrency: eventCurrency,
            nativeRemainingAmount: eventNativeRemainingAmount,
            frozenUzsAmount,
            frozenUsdUzsRate: eventFrozenUsdUzsRate,
            reversesEventId: reversed?.id ?? null,
          },
          note: reason,
        },
      })
      return { ...event, duplicate: false }
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
    return ok(result, result.duplicate ? 'Bu amal avval bajarilgan' : "Nasiya undirish holati yangilandi")
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && 'status' in error) {
      const typed = error as { status: number; message: string }
      if (typed.status === 400) return badRequest(typed.message)
      if (typed.status === 404) return notFound(typed.message)
      if (typed.status === 409) return conflict(typed.message)
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return conflict("Idempotency-Key bo'yicha amal allaqachon yozilgan")
    }
    logger.error('[POST /api/nasiya/[id]/resolution]', { event: 'api.route_error', error })
    return serverError()
  }
}
