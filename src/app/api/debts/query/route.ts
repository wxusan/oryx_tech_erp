import { NextRequest } from 'next/server'
import { z } from 'zod'
import { requireShopAnyPermission, resolveActiveShopId } from '@/lib/api-auth'
import { badRequest, forbidden, ok, serverError, tooManyRequests } from '@/lib/api-helpers'
import { principalHasFeature, principalHasPermission } from '@/lib/server/shop-access'
import { queryDebts } from '@/lib/server/debts'
import { checkRateLimitDistributed } from '@/lib/rate-limit-adapter'
import { rateLimitKey } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'

const querySchema = z.object({
  tab: z.enum(['outgoing', 'incoming']),
  month: z.union([z.literal('ALL'), z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)]).optional(),
  status: z.enum(['ALL', 'PENDING', 'PARTIAL', 'OVERDUE']).optional(),
  cursor: z.string().max(500).optional(),
  search: z.string().trim().max(100).optional(),
  take: z.number().int().min(1).max(30).optional(),
  shopId: z.string().optional(),
})

export async function POST(req: NextRequest) {
  const startedAt = performance.now()
  try {
    const guarded = await requireShopAnyPermission([
      'SUPPLIER_PAYABLE_VIEW', 'SUPPLIER_PAYMENT_RECORD', 'SUPPLIER_PAYMENT_MARK_PAID',
      'RECEIVABLES_VIEW', 'SALE_VIEW', 'SALE_PAYMENT_RECEIVE',
    ])
    if (!guarded.ok) return guarded.response
    const body: unknown = await req.json()
    const parsed = querySchema.safeParse(body)
    if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? "So'rov noto'g'ri")
    const resolved = await resolveActiveShopId(guarded.session, parsed.data.shopId)
    if (!resolved.ok) return resolved.response
    const canOutgoing = guarded.session.user.role === 'SUPER_ADMIN' || Boolean(
      guarded.principal && principalHasFeature(guarded.principal, 'INVENTORY') &&
      ['SUPPLIER_PAYABLE_VIEW', 'SUPPLIER_PAYMENT_RECORD', 'SUPPLIER_PAYMENT_MARK_PAID'].some((permission) =>
        principalHasPermission(guarded.principal!, permission as 'SUPPLIER_PAYABLE_VIEW' | 'SUPPLIER_PAYMENT_RECORD' | 'SUPPLIER_PAYMENT_MARK_PAID'),
      ),
    )
    const canIncoming = guarded.session.user.role === 'SUPER_ADMIN' || Boolean(
      guarded.principal && principalHasFeature(guarded.principal, 'CASH_SALES') &&
      ['RECEIVABLES_VIEW', 'SALE_VIEW', 'SALE_PAYMENT_RECEIVE'].some((permission) =>
        principalHasPermission(guarded.principal!, permission as 'RECEIVABLES_VIEW' | 'SALE_VIEW' | 'SALE_PAYMENT_RECEIVE'),
      ),
    )
    if ((parsed.data.tab === 'outgoing' && !canOutgoing) || (parsed.data.tab === 'incoming' && !canIncoming)) {
      return forbidden("Bu qarzlar turini ko'rish uchun ruxsat berilmagan")
    }
    const rate = await checkRateLimitDistributed(
      rateLimitKey('debts-query', resolved.shopId, guarded.session.user.id),
      { windowMs: 60_000, max: 90 },
    )
    if (!rate.allowed) return tooManyRequests(rate.retryAfterSeconds)
    const result = await queryDebts(resolved.shopId, parsed.data)
    logger.info('Debt query completed', {
      event: 'performance.debts_query',
      tab: parsed.data.tab,
      resultSize: result.items.length,
      durationMs: Math.round(performance.now() - startedAt),
      searched: Boolean(parsed.data.search),
    })
    return ok(result)
  } catch (error) {
    logger.error('[POST /api/debts/query]', { event: 'api.route_error', error })
    return serverError()
  }
}
