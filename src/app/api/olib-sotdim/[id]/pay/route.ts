/** Compatibility endpoint for the previously deployed binary "mark paid" UI. */
import { NextRequest, after } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireShopAnyPermission, resolveActiveShopId } from '@/lib/api-auth'
import { badRequest, conflict, forbidden, notFound, ok, serverError, tooManyRequests } from '@/lib/api-helpers'
import { markSupplierPayablePaidSchema } from '@/lib/validations'
import { getShopCurrencyContext } from '@/lib/server/currency'
import {
  recordSupplierPayablePayment,
  replayCommittedSupplierPayablePayment,
  SupplierPayablePaymentError,
} from '@/lib/server/supplier-payable-payments'
import { invalidateShopSupplierPayableMutation } from '@/lib/server/cache-tags'
import { flushQueuedTelegramWork } from '@/lib/notification-service'
import { logger } from '@/lib/logger'
import { checkRateLimitDistributed } from '@/lib/rate-limit-adapter'
import { rateLimitKey } from '@/lib/rate-limit'
import type { ZodError } from 'zod'

type RouteContext = { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, context: RouteContext) {
  try {
    const guarded = await requireShopAnyPermission(['SUPPLIER_PAYMENT_RECORD', 'SUPPLIER_PAYMENT_MARK_PAID'])
    if (!guarded.ok) return guarded.response
    const { session } = guarded
    const { id } = await context.params
    const submittedIdempotencyKey = req.headers.get('idempotency-key')
    // Old deployed clients did not send a key. This endpoint can only close
    // one payable once, so the payable id is its stable legacy command id.
    const idempotencyKey = submittedIdempotencyKey === null
      ? `legacy-full:${id}`
      : submittedIdempotencyKey.trim()
    if (idempotencyKey.length < 8 || idempotencyKey.length > 120) {
      return badRequest("Idempotency-Key sarlavhasi 8–120 belgidan iborat bo'lishi shart")
    }
    const body: unknown = await req.json()
    const parsed = markSupplierPayablePaidSchema.safeParse(body)
    if (!parsed.success) return badRequest((parsed.error as ZodError).issues[0]?.message ?? "Noto'g'ri ma'lumot")
    const resolved = await resolveActiveShopId(session, (body as { shopId?: string }).shopId)
    if (!resolved.ok) return resolved.response
    const committedReplay = await replayCommittedSupplierPayablePayment({
      shopId: resolved.shopId,
      supplierPayableId: id,
      actorId: session.user.id,
      idempotencyKey,
      input: parsed.data,
    })
    if (committedReplay) {
      return ok(committedReplay, "To'lov avval qayd etilgan")
    }

    const rate = await checkRateLimitDistributed(
      rateLimitKey('supplier-payable-payment-legacy', resolved.shopId, session.user.id),
      { windowMs: 60_000, max: 20 },
    )
    if (!rate.allowed) return tooManyRequests(rate.retryAfterSeconds)
    const payable = await prisma.supplierPayable.findFirst({
      where: { id, shopId: resolved.shopId, deletedAt: null },
      select: { contractCurrency: true, contractRemainingAmount: true, ledgerVersion: true },
    })
    if (!payable) return notFound('Qarz yozuvi topilmadi')
    if (parsed.data.inputCurrency && parsed.data.inputCurrency !== payable.contractCurrency) {
      return badRequest("To'liq to'lov qarzning shartnoma valyutasida kiritilishi shart")
    }
    const result = await recordSupplierPayablePayment({
      shopId: resolved.shopId,
      supplierPayableId: id,
      actorId: session.user.id,
      actorName: session.user.name,
      actorType: session.user.role as 'SUPER_ADMIN' | 'SHOP_ADMIN',
      input: {
        amount: Number(payable.contractRemainingAmount),
        inputCurrency: payable.contractCurrency,
        paymentMethod: parsed.data.paymentMethod,
        paidAt: parsed.data.paidAt,
        note: parsed.data.note,
      },
      idempotencyKey,
      currency: await getShopCurrencyContext(resolved.shopId),
      committedReplayChecked: true,
    })
    if (!result.duplicate) invalidateShopSupplierPayableMutation(resolved.shopId)
    after(() => flushQueuedTelegramWork().catch((error) => logger.warn('notification flush failed', {
      event: 'notification.flush_failed', route: '/api/olib-sotdim/[id]/pay', error,
    })))
    return ok(result, result.duplicate ? "To'lov avval qayd etilgan" : "Yetkazib beruvchiga to'lov qayd etildi")
  } catch (error) {
    if (error instanceof SupplierPayablePaymentError) {
      if (error.status === 400) return badRequest(error.message)
      if (error.status === 403) return forbidden(error.message)
      if (error.status === 404) return notFound(error.message)
      return conflict(error.message)
    }
    logger.error('[PATCH /api/olib-sotdim/[id]/pay]', { event: 'api.route_error', error })
    return serverError()
  }
}
