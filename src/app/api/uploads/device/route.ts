import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { badRequest, forbidden, ok, serverError, tooManyRequests } from '@/lib/api-helpers'
import { requireApiSession } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'
import { hasValidImageSignature } from '@/lib/server/image-signature'
import { getSupabaseAdminClient, PRIVATE_STORAGE_BUCKET } from '@/lib/supabase-admin'
import { logger } from '@/lib/logger'
import { rateLimitKey } from '@/lib/rate-limit'
import { checkRateLimitDistributed } from '@/lib/rate-limit-adapter'
import { ensurePrivateStorageBucket, PRIVATE_UPLOAD_MAX_FILE_SIZE } from '@/lib/server/private-storage-bucket'

export const runtime = 'nodejs'

const MAX_FILE_SIZE = PRIVATE_UPLOAD_MAX_FILE_SIZE
const ALLOWED_MIME_TYPES = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
])

function isAuthorizedForKey(role: string, sessionShopId: string | null | undefined, key: string) {
  if (role === 'SUPER_ADMIN') return true
  if (!sessionShopId) return false
  return key.startsWith(`shops/${sessionShopId}/devices/`)
}

function getDeviceImageUrl(requestUrl: string, key: string) {
  const url = new URL('/api/uploads/device', requestUrl)
  url.searchParams.set('key', key)
  return url.toString()
}

export async function POST(request: Request) {
  const guarded = await requireApiSession()
  if (!guarded.ok) return guarded.response

  try {
    const formData = await request.formData()
    const file = formData.get('file')
    const requestedShopId = formData.get('shopId')
    const shopId =
      guarded.session.user.role === 'SHOP_ADMIN'
        ? guarded.session.user.shopId
        : typeof requestedShopId === 'string'
          ? requestedShopId
          : null

    if (!shopId) return badRequest("shopId talab qilinadi")

    // Per-instance abuse guard (not distributed — see src/lib/rate-limit.ts).
    const rate = await checkRateLimitDistributed(rateLimitKey('upload-device', shopId, guarded.session.user.id), { windowMs: 60_000, max: 30 })
    if (!rate.allowed) return tooManyRequests(rate.retryAfterSeconds)

    if (!(file instanceof File)) return badRequest('Qurilma rasmi tanlanmagan')

    const extension = ALLOWED_MIME_TYPES.get(file.type)
    if (!extension) return badRequest('Faqat JPG, PNG yoki WEBP rasm yuklash mumkin')
    if (file.size <= 0) return badRequest("Bo'sh fayl yuklash mumkin emas")
    if (file.size > MAX_FILE_SIZE) return badRequest('Rasm hajmi 5 MB dan oshmasligi kerak')

    const shop = await prisma.shop.findFirst({
      where: { id: shopId, status: 'ACTIVE', deletedAt: null },
      select: { id: true },
    })
    if (!shop) return forbidden("Do'kon faol emas yoki topilmadi")

    const supabase = await ensurePrivateStorageBucket()
    const key = `shops/${shopId}/devices/${Date.now()}-${randomUUID()}.${extension}`
    const bytes = Buffer.from(await file.arrayBuffer())
    if (!hasValidImageSignature(bytes, file.type)) {
      return badRequest('Rasm fayli formati noto\'g\'ri yoki shikastlangan')
    }
    const { error } = await supabase.storage.from(PRIVATE_STORAGE_BUCKET).upload(key, bytes, {
      contentType: file.type,
      upsert: false,
    })

    if (error) throw error

    return ok({ key, url: getDeviceImageUrl(request.url, key) })
  } catch (error) {
    logger.error('[uploads/device] upload failed', { event: 'api.route_error', error })
    return serverError('Qurilma rasmini yuklashda xatolik')
  }
}

export async function GET(request: Request) {
  const guarded = await requireApiSession()
  if (!guarded.ok) return guarded.response

  try {
    const { searchParams } = new URL(request.url)
    const key = searchParams.get('key')
    if (!key) return badRequest('Fayl kaliti kiritilishi shart')
    if (!/^shops\/[^/]+\/devices\/[^/]+$/.test(key)) {
      return badRequest("Fayl kaliti noto'g'ri")
    }

    if (!isAuthorizedForKey(guarded.session.user.role, guarded.session.user.shopId, key)) {
      return forbidden()
    }

    const supabase = getSupabaseAdminClient()
    const { data, error } = await supabase.storage
      .from(PRIVATE_STORAGE_BUCKET)
      .createSignedUrl(key, 60 * 5)

    if (error) throw error

    const response = NextResponse.redirect(data.signedUrl)
    response.headers.set('Cache-Control', 'private, no-store')
    return response
  } catch (error) {
    logger.error('[uploads/device] signed url failed', { event: 'api.route_error', error })
    return serverError('Qurilma rasmini ochishda xatolik')
  }
}
