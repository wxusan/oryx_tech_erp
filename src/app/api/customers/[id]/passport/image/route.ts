import { NextRequest, NextResponse } from 'next/server'
import { requireShopPermission, resolveActiveShopId } from '@/lib/api-auth'
import { notFound, serverError } from '@/lib/api-helpers'
import { logger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import { getSupabaseAdminClient, PRIVATE_STORAGE_BUCKET } from '@/lib/supabase-admin'

type RouteContext = { params: Promise<{ id: string }> }

/** Resolve a customer-owned private image without exposing its storage key. */
export async function GET(_req: NextRequest, ctx: RouteContext) {
  try {
    const guarded = await requireShopPermission('CUSTOMER_PASSPORT_PHOTO_VIEW')
    if (!guarded.ok) return guarded.response
    const resolved = await resolveActiveShopId(guarded.session, null)
    if (!resolved.ok) return resolved.response
    const { id } = await ctx.params

    const customer = await prisma.customer.findFirst({
      where: { id, shopId: resolved.shopId, deletedAt: null },
      select: { passportPhotoUrl: true },
    })
    if (!customer?.passportPhotoUrl) return notFound('Pasport rasmi topilmadi')
    if (!customer.passportPhotoUrl.startsWith(`shops/${resolved.shopId}/passports/`)) {
      return notFound('Pasport rasmi topilmadi')
    }

    const { data, error } = await getSupabaseAdminClient().storage
      .from(PRIVATE_STORAGE_BUCKET)
      .createSignedUrl(customer.passportPhotoUrl, 60 * 5)
    if (error || !data?.signedUrl) throw error ?? new Error('Signed URL yaratilmagan')

    return NextResponse.json(
      { success: true, data: { url: data.signedUrl } },
      { headers: { 'Cache-Control': 'private, no-store, max-age=0' } },
    )
  } catch (error) {
    logger.error('[GET /api/customers/[id]/passport/image]', { event: 'api.route_error', error })
    return serverError("Pasport rasmini ochib bo'lmadi")
  }
}
