import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { badRequest, forbidden, ok, payloadTooLarge, serverError, tooManyRequests } from '@/lib/api-helpers'
import { requireShopAnyPermission, requireShopPermission } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'
import { validatePrivateUploadImage } from '@/lib/server/image-validation'
import { getSupabaseAdminClient, PRIVATE_STORAGE_BUCKET } from '@/lib/supabase-admin'
import { logger } from '@/lib/logger'
import { rateLimitKey } from '@/lib/rate-limit'
import { checkRateLimitDistributed } from '@/lib/rate-limit-adapter'
import {
  ensurePrivateStorageBucket,
  PRIVATE_UPLOAD_MAX_FILE_SIZE,
  PRIVATE_UPLOAD_MAX_REQUEST_SIZE,
} from '@/lib/server/private-storage-bucket'
import {
  isInvalidRequestBody,
  isRequestBodyTooLarge,
  readLimitedFormDataBody,
} from '@/lib/server/request-limits'
import {
  createPrivateUploadReference,
  privateUploadPreviewUrl,
  readPrivateUploadReference,
} from '@/lib/server/private-upload-reference'

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
  return key.startsWith(`shops/${sessionShopId}/passports/`)
}

export async function POST(request: Request) {
  const guarded = await requireShopAnyPermission(['NASIYA_CREATE', 'CUSTOMER_MANAGE', 'IMPORT_DATA'])
  if (!guarded.ok) return guarded.response

  try {
    const formData = await readLimitedFormDataBody(request, PRIVATE_UPLOAD_MAX_REQUEST_SIZE)
    const file = formData.get('file')
    const requestedShopId = formData.get('shopId')
    const shopId =
      guarded.session.user.role === 'SHOP_ADMIN'
        ? guarded.session.user.shopId
        : typeof requestedShopId === 'string'
          ? requestedShopId
          : null

    if (!shopId) return badRequest("shopId talab qilinadi")

    // Distributed when Upstash is configured; bounded in-process fallback otherwise.
    const rate = await checkRateLimitDistributed(rateLimitKey('upload-passport', shopId, guarded.session.user.id), { windowMs: 60_000, max: 30 })
    if (!rate.allowed) return tooManyRequests(rate.retryAfterSeconds)

    if (!(file instanceof File)) return badRequest('Pasport rasmi tanlanmagan')

    const extension = ALLOWED_MIME_TYPES.get(file.type)
    if (!extension) return badRequest('Faqat JPG, PNG yoki WEBP rasm yuklash mumkin')
    if (file.size <= 0) return badRequest("Bo'sh fayl yuklash mumkin emas")
    if (file.size > MAX_FILE_SIZE) return badRequest('Rasm hajmi 5 MB dan oshmasligi kerak')

    const shop = await prisma.shop.findFirst({
      where: { id: shopId, status: 'ACTIVE', deletedAt: null },
      select: { id: true },
    })
    if (!shop) return forbidden("Do'kon faol emas yoki topilmadi")

    const key = `shops/${shopId}/passports/${Date.now()}-${randomUUID()}.${extension}`
    const bytes = Buffer.from(await file.arrayBuffer())
    const imageValidation = await validatePrivateUploadImage(bytes, file.type)
    if (!imageValidation.ok) {
      return badRequest('Rasm fayli formati noto\'g\'ri yoki shikastlangan')
    }
    const supabase = await ensurePrivateStorageBucket()
    const { error } = await supabase.storage.from(PRIVATE_STORAGE_BUCKET).upload(key, bytes, {
      contentType: file.type,
      upsert: false,
    })

    if (error) throw error

    const reference = createPrivateUploadReference({ key, shopId, kind: 'passport' })
    return ok({
      reference,
      url: new URL(privateUploadPreviewUrl('passport', reference), request.url).toString(),
    })
  } catch (error) {
    if (isRequestBodyTooLarge(error)) return payloadTooLarge('Rasm yuklash so\'rovi 5 MB chegaradan oshdi')
    if (isInvalidRequestBody(error)) return badRequest("Rasm yuklash so'rovi noto'g'ri")
    logger.error('[uploads/passport] upload failed', { event: 'api.route_error', error })
    return serverError('Pasport rasmini yuklashda xatolik')
  }
}

export async function GET(request: Request) {
  const guarded = await requireShopPermission('NASIYA_VIEW')
  if (!guarded.ok) return guarded.response

  try {
    const { searchParams } = new URL(request.url)
    const reference = searchParams.get('reference')
    if (!reference) return badRequest('Rasm havolasi kiritilishi shart')
    const payload = readPrivateUploadReference({ reference, kind: 'passport' })
    if (!payload) return badRequest("Rasm havolasi noto'g'ri yoki muddati tugagan")
    const key = payload.key

    if (
      !isAuthorizedForKey(guarded.session.user.role, guarded.session.user.shopId, key) ||
      (guarded.session.user.role !== 'SUPER_ADMIN' && payload.shopId !== guarded.session.user.shopId)
    ) {
      return forbidden()
    }

    const supabase = getSupabaseAdminClient()
    const { data, error } = await supabase.storage
      .from(PRIVATE_STORAGE_BUCKET)
      .createSignedUrl(key, 60 * 5)

    if (error) throw error
    return NextResponse.json(
      { success: true, data: { url: data.signedUrl } },
      { headers: { 'Cache-Control': 'private, no-store' } },
    )
  } catch (error) {
    logger.error('[uploads/passport] signed url failed', { event: 'api.route_error', error })
    return serverError('Pasport rasmini ochishda xatolik')
  }
}
