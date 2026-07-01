import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireApiSession, resolveActiveShopId } from '@/lib/api-auth'
import { ok, serverError } from '@/lib/api-helpers'

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

    const customers = await prisma.customer.findMany({
      where: {
        shopId: resolved.shopId,
        deletedAt: null,
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: 'insensitive' } },
                { phone: { contains: search, mode: 'insensitive' } },
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
        note: true,
        createdAt: true,
        _count: { select: { sales: true, nasiya: true } },
      },
    })

    return ok(customers, "Mijozlar ro'yxati")
  } catch (err) {
    console.error('[GET /api/customers]', err)
    return serverError()
  }
}
