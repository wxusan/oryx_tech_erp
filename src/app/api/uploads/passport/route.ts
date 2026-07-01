import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { badRequest, forbidden, ok, serverError } from '@/lib/api-helpers'
import { requireApiSession } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'
import { getSupabaseAdminClient, PRIVATE_STORAGE_BUCKET } from '@/lib/supabase-admin'

export const runtime = 'nodejs'

const MAX_FILE_SIZE = 5 * 1024 * 1024
const ALLOWED_MIME_TYPES = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
])

async function ensurePrivateBucket() {
  const supabase = getSupabaseAdminClient()
  const { data: buckets, error: listError } = await supabase.storage.listBuckets()

  if (listError) throw listError
  const existingBucket = buckets.find((bucket) => bucket.name === PRIVATE_STORAGE_BUCKET)
  if (existingBucket) {
    if (existingBucket.public) {
      const { error: updateError } = await supabase.storage.updateBucket(PRIVATE_STORAGE_BUCKET, {
        public: false,
        fileSizeLimit: `${MAX_FILE_SIZE}`,
        allowedMimeTypes: [...ALLOWED_MIME_TYPES.keys()],
      })
      if (updateError) throw updateError
    }
    return supabase
  }

  const { error: createError } = await supabase.storage.createBucket(PRIVATE_STORAGE_BUCKET, {
    public: false,
    fileSizeLimit: `${MAX_FILE_SIZE}`,
    allowedMimeTypes: [...ALLOWED_MIME_TYPES.keys()],
  })

  if (createError && !createError.message.toLowerCase().includes('already exists')) {
    throw createError
  }

  return supabase
}

function isAuthorizedForKey(role: string, sessionShopId: string | null | undefined, key: string) {
  if (role === 'SUPER_ADMIN') return true
  if (!sessionShopId) return false
  return key.startsWith(`shops/${sessionShopId}/passports/`)
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

    const supabase = await ensurePrivateBucket()
    const key = `shops/${shopId}/passports/${Date.now()}-${randomUUID()}.${extension}`
    const bytes = Buffer.from(await file.arrayBuffer())
    const { error } = await supabase.storage.from(PRIVATE_STORAGE_BUCKET).upload(key, bytes, {
      contentType: file.type,
      upsert: false,
    })

    if (error) throw error

    return ok({ key })
  } catch (error) {
    console.error('[uploads/passport] upload failed', error)
    return serverError('Pasport rasmini yuklashda xatolik')
  }
}

export async function GET(request: Request) {
  const guarded = await requireApiSession()
  if (!guarded.ok) return guarded.response

  try {
    const { searchParams } = new URL(request.url)
    const key = searchParams.get('key')
    if (!key) return badRequest('Fayl kaliti kiritilishi shart')
    if (!/^shops\/[^/]+\/passports\/[^/]+$/.test(key)) {
      return badRequest('Fayl kaliti noto\'g\'ri')
    }

    if (!isAuthorizedForKey(guarded.session.user.role, guarded.session.user.shopId, key)) {
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
    console.error('[uploads/passport] signed url failed', error)
    return serverError('Pasport rasmini ochishda xatolik')
  }
}
