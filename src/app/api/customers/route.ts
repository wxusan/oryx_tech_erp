import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireApiSession, resolveActiveShopId } from '@/lib/api-auth'
import { ok, serverError } from '@/lib/api-helpers'
import { normalizePhone } from '@/lib/phone'
import { logger } from '@/lib/logger'

export async function GET(req: NextRequest) {
  try {
    const guarded = await requireApiSession()
    if (!guarded.ok) return guarded.response
    const { session } = guarded

    const { searchParams } = req.nextUrl
    const resolved = await resolveActiveShopId(session, searchParams.get('shopId'))
    if (!resolved.ok) return resolved.response

    const search = searchParams.get('search')?.trim()
    const requestedTake = Number(searchParams.get('take') ?? 200)
    const requestedSkip = Number(searchParams.get('skip') ?? 0)
    const take = Number.isFinite(requestedTake) ? Math.trunc(Math.min(Math.max(requestedTake, 1), 500)) : 200
    const skip = Number.isFinite(requestedSkip) ? Math.trunc(Math.max(requestedSkip, 0)) : 0

    // Phone search handles spaces/plus signs by also matching the normalized
    // (digits-only) phone, so "90 123 45 67" finds "+998901234567".
    const searchDigits = search ? normalizePhone(search) : null

    const customers = await prisma.customer.findMany({
      where: {
        shopId: resolved.shopId,
        deletedAt: null,
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: 'insensitive' } },
                { phone: { contains: search, mode: 'insensitive' } },
                { note: { contains: search, mode: 'insensitive' } },
                ...(searchDigits ? [{ normalizedPhone: { contains: searchDigits } }] : []),
                ...(searchDigits ? [{ additionalPhones: { has: searchDigits } }] : []),
              ],
            }
          : {}),
      },
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
        _count: {
          select: {
            sales: { where: { deletedAt: null } },
            nasiya: { where: { deletedAt: null, status: { not: 'CANCELLED' } } },
          },
        },
      },
    })

    return ok(customers, "Mijozlar ro'yxati")
  } catch (err) {
    logger.error('[GET /api/customers]', { event: 'api.route_error', error: err })
    return serverError()
  }
}
