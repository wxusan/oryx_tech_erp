import { z, ZodError } from 'zod'
import { requireShopPermission, resolveActiveShopId } from '@/lib/api-auth'
import { badRequest, ok, payloadTooLarge, serverError } from '@/lib/api-helpers'
import { logger } from '@/lib/logger'
import { getCustomerList } from '@/lib/server/customer-list'
import {
  isInvalidRequestBody,
  isRequestBodyTooLarge,
  readLimitedJsonBody,
} from '@/lib/server/request-limits'

const customerSearchSchema = z.object({
  search: z.string().trim().max(100).default(''),
  skip: z.number().int().min(0).default(0),
  take: z.number().int().min(1).max(100).default(25),
  shopId: z.string().optional(),
})

/**
 * Customer search is POST-only so protected passport identifiers never enter
 * request URLs, browser history, access logs, or intermediary cache keys.
 */
export async function POST(request: Request) {
  try {
    const guarded = await requireShopPermission('CUSTOMER_VIEW')
    if (!guarded.ok) return guarded.response

    const parsed = customerSearchSchema.safeParse(await readLimitedJsonBody(request))
    if (!parsed.success) {
      return badRequest((parsed.error as ZodError).issues[0]?.message ?? "Noto'g'ri qidiruv")
    }
    const resolved = await resolveActiveShopId(guarded.session, parsed.data.shopId)
    if (!resolved.ok) return resolved.response

    const data = await getCustomerList({
      shopId: resolved.shopId,
      search: parsed.data.search,
      skip: parsed.data.skip,
      take: parsed.data.take,
    })
    const response = ok(data, 'Mijoz qidiruvi')
    response.headers.set('Cache-Control', 'private, no-store')
    return response
  } catch (error) {
    if (isRequestBodyTooLarge(error)) return payloadTooLarge('Qidiruv so\'rovi hajmi chegaradan oshdi')
    if (isInvalidRequestBody(error)) return badRequest("Qidiruv so'rovi noto'g'ri")
    // Do not attach the thrown value: database/validation errors can include
    // the searched identifier. The error class is enough for operations.
    logger.error('[POST /api/customers/search]', {
      event: 'api.route_error',
      error: { name: error instanceof Error ? error.name : 'UnknownError' },
    })
    return serverError()
  }
}
