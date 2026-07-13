import { NextRequest } from 'next/server'
import { z, ZodError } from 'zod'
import { requireShopAnyPermission, resolveActiveShopId } from '@/lib/api-auth'
import { badRequest, ok, payloadTooLarge, serverError } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { customerSearchWhere } from '@/lib/server/customer-search'
import { getCustomerTrustFactorsForList } from '@/lib/server/customer-trust-queries'
import { computeCustomerTrustRatingFromFactors, isValidTrustTier, type CustomerTrustFactors } from '@/lib/nasiya-customer-trust'
import {
  isInvalidRequestBody,
  isRequestBodyTooLarge,
  readLimitedJsonBody,
} from '@/lib/server/request-limits'

const EMPTY_FACTORS: CustomerTrustFactors = {
  totalNasiyaCount: 0,
  completedNasiyaCount: 0,
  activeNasiyaCount: 0,
  cancelledNasiyaCount: 0,
  paidInstallmentCount: 0,
  onTimeRatio: null,
  lateInstallmentCount: 0,
  maxDaysLate: 0,
  currentOverdueScheduleCount: 0,
  hasCurrentOverdue: false,
}

const pickerSearchSchema = z.object({
  search: z.string().trim().min(2).max(100),
  shopId: z.string().optional(),
})

/** Limited identity/trust DTO for operational customer selection. */
export async function POST(req: NextRequest) {
  try {
    const guarded = await requireShopAnyPermission([
      'CUSTOMER_VIEW',
      'CASH_SALE_CREATE',
      'NASIYA_CREATE',
      'OLIB_MANAGE',
    ])
    if (!guarded.ok) return guarded.response
    const parsed = pickerSearchSchema.safeParse(await readLimitedJsonBody(req))
    if (!parsed.success) {
      return badRequest((parsed.error as ZodError).issues[0]?.message ?? 'Qidiruv 2–100 ta belgidan iborat bo\'lishi kerak')
    }
    const resolved = await resolveActiveShopId(guarded.session, parsed.data.shopId)
    if (!resolved.ok) return resolved.response

    const customers = await prisma.customer.findMany({
      where: customerSearchWhere(resolved.shopId, parsed.data.search),
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: 10,
      select: {
        id: true,
        name: true,
        phone: true,
        additionalPhones: true,
        trustOverride: true,
        passportIdentifierLast4: true,
        passportPhotoUrl: true,
        _count: {
          select: {
            sales: { where: { deletedAt: null } },
            nasiya: { where: { deletedAt: null, status: { not: 'CANCELLED' } } },
          },
        },
      },
    })
    const factors = await getCustomerTrustFactorsForList({
      shopId: resolved.shopId,
      customerIds: customers.map(({ id }) => id),
    })

    const response = ok(customers.map(({ trustOverride, passportIdentifierLast4, passportPhotoUrl, ...customer }) => {
      const trust = computeCustomerTrustRatingFromFactors(
        factors.get(customer.id) ?? EMPTY_FACTORS,
        isValidTrustTier(trustOverride) ? trustOverride : null,
      )
      return {
        ...customer,
        passportMasked: passportIdentifierLast4 ? `••••${passportIdentifierLast4}` : null,
        hasPassportPhoto: Boolean(passportPhotoUrl),
        trust: { tier: trust.tier, label: trust.label, color: trust.color },
      }
    }), 'Mijoz qidiruvi')
    response.headers.set('Cache-Control', 'private, no-store')
    return response
  } catch (error) {
    if (isRequestBodyTooLarge(error)) return payloadTooLarge('Qidiruv so\'rovi hajmi chegaradan oshdi')
    if (isInvalidRequestBody(error)) return badRequest("Qidiruv so'rovi noto'g'ri")
    logger.error('[POST /api/customers/picker]', {
      event: 'api.route_error',
      error: { name: error instanceof Error ? error.name : 'UnknownError' },
    })
    return serverError()
  }
}
