/**
 * GET /api/customers/by-phone?phone=... — item 12. Used by the nasiya
 * creation form (and any other "customer is being entered by phone, not
 * picked from a list" flow) to show an existing customer's trust badge
 * before the deal is created. Returns `{ found: false }` (not a 404) for a
 * phone that doesn't match anyone yet — a brand-new customer is a normal,
 * expected result here, not an error.
 */
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireShopPermission, resolveActiveShopId } from '@/lib/api-auth'
import { ok, badRequest, serverError } from '@/lib/api-helpers'
import { normalizePhone } from '@/lib/phone'
import { logger } from '@/lib/logger'
import { computeCustomerTrustRating, isValidTrustTier, type CustomerNasiyaInput } from '@/lib/nasiya-customer-trust'

export async function GET(req: NextRequest) {
  try {
    const guarded = await requireShopPermission('CUSTOMER_VIEW')
    if (!guarded.ok) return guarded.response
    const { session } = guarded

    const { searchParams } = req.nextUrl
    const resolved = await resolveActiveShopId(session, searchParams.get('shopId'))
    if (!resolved.ok) return resolved.response

    const phone = searchParams.get('phone')?.trim()
    if (!phone) return badRequest('Telefon raqami kerak')
    const normalizedPhone = normalizePhone(phone)
    if (!normalizedPhone) return ok({ found: false }, 'Mijoz topilmadi')

    const customer = await prisma.customer.findFirst({
      where: { shopId: resolved.shopId, deletedAt: null, normalizedPhone },
      select: {
        id: true,
        name: true,
        phone: true,
        trustOverride: true,
        nasiya: {
          where: { deletedAt: null },
          select: {
            status: true,
            contractCurrency: true,
            schedules: {
              select: {
                status: true,
                dueDate: true,
                delayedUntil: true,
                contractExpectedAmount: true,
                contractPaidAmount: true,
                paidAt: true,
              },
            },
          },
        },
      },
    })
    if (!customer) return ok({ found: false }, 'Mijoz topilmadi')

    const nasiyaInputs: CustomerNasiyaInput[] = customer.nasiya.map((n) => ({
      status: n.status,
      contractCurrency: n.contractCurrency,
      schedules: n.schedules.map((s) => ({
        status: s.status,
        dueDate: s.dueDate,
        delayedUntil: s.delayedUntil,
        expectedAmount: Number(s.contractExpectedAmount),
        paidAmount: Number(s.contractPaidAmount),
        paidAt: s.paidAt,
      })),
    }))
    const override = isValidTrustTier(customer.trustOverride) ? customer.trustOverride : null
    const trust = computeCustomerTrustRating(nasiyaInputs, new Date(), override)

    return ok({ found: true, id: customer.id, name: customer.name, phone: customer.phone, trust }, 'Mijoz topildi')
  } catch (err) {
    logger.error('[GET /api/customers/by-phone]', { event: 'api.route_error', error: err })
    return serverError()
  }
}
