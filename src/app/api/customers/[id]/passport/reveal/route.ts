import { NextRequest, NextResponse } from 'next/server'
import { requireShopPermission, resolveActiveShopId } from '@/lib/api-auth'
import { notFound, serverError } from '@/lib/api-helpers'
import { decryptPassportIdentifier } from '@/lib/customer-passport'
import { logger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'

type RouteContext = { params: Promise<{ id: string }> }

/** Every full identifier reveal is permission-gated, tenant-scoped and audited. */
export async function POST(_req: NextRequest, ctx: RouteContext) {
  try {
    const guarded = await requireShopPermission('CUSTOMER_PII_REVEAL')
    if (!guarded.ok) return guarded.response
    const resolved = await resolveActiveShopId(guarded.session, null)
    if (!resolved.ok) return resolved.response
    const { id } = await ctx.params

    const customer = await prisma.customer.findFirst({
      where: { id, shopId: resolved.shopId, deletedAt: null },
      select: { id: true, passportIdentifierCiphertext: true },
    })
    if (!customer?.passportIdentifierCiphertext) return notFound("Mijozning pasport raqami saqlanmagan")

    const identifier = decryptPassportIdentifier(customer.passportIdentifierCiphertext)
    await prisma.log.create({
      data: {
        shopId: resolved.shopId,
        actorId: guarded.session.user.id,
        actorType: guarded.session.user.role as 'SUPER_ADMIN' | 'SHOP_ADMIN',
        action: 'CUSTOMER_PASSPORT_REVEAL',
        targetType: 'Customer',
        targetId: customer.id,
        newValue: { revealed: true },
        note: "To'liq pasport raqami vakolatli foydalanuvchiga vaqtincha ko'rsatildi",
      },
    })

    return NextResponse.json(
      { success: true, data: { identifier } },
      { headers: { 'Cache-Control': 'private, no-store, max-age=0' } },
    )
  } catch (error) {
    logger.error('[POST /api/customers/[id]/passport/reveal]', { event: 'api.route_error', error })
    return serverError("Pasport raqamini ochib bo'lmadi")
  }
}
