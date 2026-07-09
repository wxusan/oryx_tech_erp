import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireApiSession, resolveActiveShopId } from '@/lib/api-auth'
import { ok, serverError } from '@/lib/api-helpers'
import { normalizePhone } from '@/lib/phone'
import { logger } from '@/lib/logger'
import { computeCustomerTrustRating, isValidTrustTier, type CustomerNasiyaInput } from '@/lib/nasiya-customer-trust'

export async function GET(req: NextRequest) {
  try {
    const guarded = await requireApiSession()
    if (!guarded.ok) return guarded.response
    const { session } = guarded

    const { searchParams } = req.nextUrl
    const resolved = await resolveActiveShopId(session, searchParams.get('shopId'))
    if (!resolved.ok) return resolved.response

    const search = searchParams.get('search')?.trim()
    // Item 2 — page size deliberately smaller than the old 200/500 defaults
    // now that this is real pagination (page/skip/take + total), not a
    // single load-everything-up-to-a-cap fetch.
    const requestedTake = Number(searchParams.get('take') ?? 25)
    const requestedSkip = Number(searchParams.get('skip') ?? 0)
    const take = Number.isFinite(requestedTake) ? Math.trunc(Math.min(Math.max(requestedTake, 1), 100)) : 25
    const skip = Number.isFinite(requestedSkip) ? Math.trunc(Math.max(requestedSkip, 0)) : 0

    // Phone search handles spaces/plus signs by also matching the normalized
    // (digits-only) phone, so "90 123 45 67" finds "+998901234567".
    const searchDigits = search ? normalizePhone(search) : null

    const where = {
      shopId: resolved.shopId,
      deletedAt: null,
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' as const } },
              { phone: { contains: search, mode: 'insensitive' as const } },
              { note: { contains: search, mode: 'insensitive' as const } },
              ...(searchDigits ? [{ normalizedPhone: { contains: searchDigits } }] : []),
              ...(searchDigits ? [{ additionalPhones: { has: searchDigits } }] : []),
            ],
          }
        : {}),
    }

    const [customers, total] = await Promise.all([
      prisma.customer.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take,
      skip,
      select: {
        id: true,
        shopId: true,
        name: true,
        phone: true,
        additionalPhones: true,
        note: true,
        createdAt: true,
        trustOverride: true,
        _count: {
          select: {
            sales: { where: { deletedAt: null } },
            nasiya: { where: { deletedAt: null, status: { not: 'CANCELLED' } } },
          },
        },
        // Item 12 — list badge. Bounded (take is capped at 500, and each
        // customer's own nasiya/schedule count is small), so this stays a
        // single batched query rather than genuine per-row N+1.
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
      }),
      prisma.customer.count({ where }),
    ])

    const withTrust = customers.map(({ nasiya, trustOverride, ...rest }) => {
      const nasiyaInputs: CustomerNasiyaInput[] = nasiya.map((n) => ({
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
      const override = isValidTrustTier(trustOverride) ? trustOverride : null
      const trust = computeCustomerTrustRating(nasiyaInputs, new Date(), override)
      return { ...rest, trust: { tier: trust.tier, label: trust.label, color: trust.color } }
    })

    // Item 2 — real pagination envelope (items/total/skip/take), the same
    // shape /api/logs already established. mijozlar/page.tsx is this
    // route's only consumer, so this is a safe shape change.
    return ok({ items: withTrust, total, skip, take }, "Mijozlar ro'yxati")
  } catch (err) {
    logger.error('[GET /api/customers]', { event: 'api.route_error', error: err })
    return serverError()
  }
}
