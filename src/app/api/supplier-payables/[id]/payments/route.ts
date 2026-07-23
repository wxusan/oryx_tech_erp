import { NextRequest, NextResponse, after } from 'next/server'
import { requireShopAnyPermission, resolveActiveShopId } from '@/lib/api-auth'
import { badRequest, conflict, forbidden, notFound, ok, serverError, tooManyRequests } from '@/lib/api-helpers'
import { recordSupplierPayablePaymentSchema } from '@/lib/validations'
import { validatePaymentBreakdown } from '@/lib/payment-breakdown'
import { checkRateLimitDistributed } from '@/lib/rate-limit-adapter'
import { rateLimitKey } from '@/lib/rate-limit'
import { getShopCurrencyContext } from '@/lib/server/currency'
import {
  recordSupplierPayablePayment,
  replayCommittedSupplierPayablePayment,
  SupplierPayablePaymentError,
} from '@/lib/server/supplier-payable-payments'
import { invalidateShopSupplierPayableMutation } from '@/lib/server/cache-tags'
import { flushQueuedTelegramWork } from '@/lib/notification-service'
import { logger } from '@/lib/logger'
import type { ZodError } from 'zod'

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const guarded = await requireShopAnyPermission(['SUPPLIER_PAYMENT_RECORD', 'SUPPLIER_PAYMENT_MARK_PAID'])
    if (!guarded.ok) return guarded.response
    const { session } = guarded
    const { id } = await context.params
    const body: unknown = await req.json()
    const parsed = recordSupplierPayablePaymentSchema.safeParse(body)
    if (!parsed.success) {
      return badRequest((parsed.error as ZodError).issues[0]?.message ?? "Noto'g'ri ma'lumot")
    }
    const idempotencyKey = req.headers.get('idempotency-key')?.trim() || parsed.data.idempotencyKey?.trim()
    if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 120) {
      return badRequest("Idempotency-Key sarlavhasi 8–120 belgidan iborat bo'lishi shart")
    }
    if (parsed.data.paymentBreakdown) {
      const breakdownError = validatePaymentBreakdown(
        parsed.data.paymentBreakdown,
        parsed.data.amount,
        parsed.data.inputCurrency,
      )
      if (breakdownError) return badRequest(breakdownError)
    }

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
      rateLimitKey('supplier-payable-payment', resolved.shopId, session.user.id),
      { windowMs: 60_000, max: 20 },
    )
    if (!rate.allowed) return tooManyRequests(rate.retryAfterSeconds)

    const result = await recordSupplierPayablePayment({
      shopId: resolved.shopId,
      supplierPayableId: id,
      actorId: session.user.id,
      actorName: session.user.name,
      actorType: session.user.role as 'SUPER_ADMIN' | 'SHOP_ADMIN',
      input: parsed.data,
      idempotencyKey,
      currency: await getShopCurrencyContext(resolved.shopId),
      committedReplayChecked: true,
    })
    if (!result.duplicate) invalidateShopSupplierPayableMutation(resolved.shopId)
    after(() => flushQueuedTelegramWork().catch((error) => {
      logger.warn('supplier payment notification flush failed', {
        event: 'notification.flush_failed',
        route: '/api/supplier-payables/[id]/payments',
        error,
      })
    }))
    return ok(result, result.duplicate ? "To'lov avval qayd etilgan" : "To'lov qayd etildi")
  } catch (error) {
    if (error instanceof SupplierPayablePaymentError) {
      if (error.status === 400) return badRequest(error.message)
      if (error.status === 403) return forbidden(error.message)
      if (error.status === 404) return notFound(error.message)
      if (error.context) return NextResponse.json({ success: false, error: error.message, data: error.context }, { status: 409 })
      return conflict(error.message)
    }
    logger.error('[POST /api/supplier-payables/[id]/payments]', { event: 'api.route_error', error })
    return serverError()
  }
}
