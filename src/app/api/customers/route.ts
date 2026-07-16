import { NextRequest } from 'next/server'
import { z, ZodError } from 'zod'
import { prisma } from '@/lib/prisma'
import { requireShopPermission, resolveActiveShopId } from '@/lib/api-auth'
import { badRequest, conflict, created, forbidden, ok, serverError } from '@/lib/api-helpers'
import { normalizeAdditionalPhones, normalizePhone } from '@/lib/phone'
import { logger } from '@/lib/logger'
import { CustomerPassportConfigurationError, isValidPassportIdentifier, passportIdentifierStorage } from '@/lib/customer-passport'
import { phoneSchema } from '@/lib/validations'
import { invalidateShopCustomerMutation } from '@/lib/server/cache-tags'
import { Prisma } from '@/generated/prisma/client'
import { getCustomerList } from '@/lib/server/customer-list'
import { resolvePrivateUploadReference } from '@/lib/server/private-upload-reference'
import { principalHasPermission } from '@/lib/server/shop-access'

export async function GET(req: NextRequest) {
  try {
    const guarded = await requireShopPermission('CUSTOMER_VIEW')
    if (!guarded.ok) return guarded.response
    const { session } = guarded

    const { searchParams } = req.nextUrl
    const resolved = await resolveActiveShopId(session, searchParams.get('shopId'))
    if (!resolved.ok) return resolved.response

    // Sensitive customer search is intentionally POST-only at
    // /api/customers/search. GET remains an unfiltered pagination endpoint.
    // Item 2 — page size deliberately smaller than the old 200/500 defaults
    // now that this is real pagination (page/skip/take + total), not a
    // single load-everything-up-to-a-cap fetch.
    const requestedTake = Number(searchParams.get('take') ?? 25)
    const requestedSkip = Number(searchParams.get('skip') ?? 0)
    const take = Number.isFinite(requestedTake) ? Math.trunc(Math.min(Math.max(requestedTake, 1), 100)) : 25
    const skip = Number.isFinite(requestedSkip) ? Math.trunc(Math.max(requestedSkip, 0)) : 0

    const data = await getCustomerList({
      shopId: resolved.shopId,
      skip,
      take,
    })

    // Item 2 — real pagination envelope (items/total/skip/take), the same
    // shape /api/logs already established. mijozlar/page.tsx is this
    // route's only consumer, so this is a safe shape change.
    return ok(data, "Mijozlar ro'yxati")
  } catch (err) {
    logger.error('[GET /api/customers]', { event: 'api.route_error', error: err })
    return serverError()
  }
}

const createCustomerSchema = z.object({
  name: z.string().trim().min(2, "Ism kamida 2 ta belgidan iborat bo'lishi kerak").max(100),
  phone: phoneSchema,
  additionalPhones: z.array(z.string()).max(5).optional(),
  passportIdentifier: z.string().trim().refine(isValidPassportIdentifier, "Pasport seriya/raqami AA 1234567 formatida bo'lishi kerak").optional(),
  passportPhotoUrl: z.string().max(500).optional(),
  note: z.string().trim().max(1000).optional(),
  shopId: z.string().optional(),
})

export async function POST(req: NextRequest) {
  try {
    const guarded = await requireShopPermission('CUSTOMER_CREATE')
    if (!guarded.ok) return guarded.response

    const body: unknown = await req.json()
    const parsed = createCustomerSchema.safeParse(body)
    if (!parsed.success) {
      return badRequest((parsed.error as ZodError).issues[0]?.message ?? "Noto'g'ri ma'lumot")
    }
    const includesPassport = parsed.data.passportIdentifier !== undefined || parsed.data.passportPhotoUrl !== undefined
    if (
      includesPassport && guarded.session.user.role !== 'SUPER_ADMIN' &&
      (!guarded.principal || !principalHasPermission(guarded.principal, 'CUSTOMER_PASSPORT_MANAGE'))
    ) {
      return forbidden("Pasport ma'lumotlarini qo'shish ruxsati berilmagan")
    }
    const resolved = await resolveActiveShopId(guarded.session, parsed.data.shopId)
    if (!resolved.ok) return resolved.response
    const { shopId } = resolved

    const passportPhotoKey = parsed.data.passportPhotoUrl
      ? resolvePrivateUploadReference({
          value: parsed.data.passportPhotoUrl,
          shopId,
          kind: 'passport',
          allowLegacyRawKey: true,
        })
      : undefined
    if (parsed.data.passportPhotoUrl && !passportPhotoKey) {
      return badRequest("Pasport rasmi boshqa do'konga tegishli yoki havola muddati tugagan")
    }
    const passport = parsed.data.passportIdentifier
      ? passportIdentifierStorage(parsed.data.passportIdentifier)
      : {}
    const normalizedPhone = normalizePhone(parsed.data.phone)
    const customer = await prisma.$transaction(async (tx) => {
      const inserted = await tx.customer.create({
        data: {
          shopId,
          name: parsed.data.name,
          phone: parsed.data.phone,
          normalizedPhone,
          additionalPhones: normalizeAdditionalPhones(parsed.data.additionalPhones ?? [], parsed.data.phone),
          passportPhotoUrl: passportPhotoKey,
          note: parsed.data.note,
          ...passport,
        },
        select: { id: true, name: true, phone: true, additionalPhones: true, passportIdentifierLast4: true, createdAt: true },
      })
      await tx.log.create({
        data: {
          shopId,
          actorId: guarded.session.user.id,
          actorType: guarded.session.user.role as 'SUPER_ADMIN' | 'SHOP_ADMIN',
          action: 'CUSTOMER_CREATE',
          targetType: 'Customer',
          targetId: inserted.id,
          newValue: {
            name: inserted.name,
            phone: inserted.phone,
            additionalPhoneCount: inserted.additionalPhones.length,
            hasPassportIdentifier: Boolean(inserted.passportIdentifierLast4),
            hasPassportPhoto: Boolean(passportPhotoKey),
          },
        },
      })
      return inserted
    })
    invalidateShopCustomerMutation(shopId)
    return created({
      ...customer,
      passportMasked: customer.passportIdentifierLast4 ? `••••${customer.passportIdentifierLast4}` : null,
      passportIdentifierLast4: undefined,
    }, 'Mijoz yaratildi')
  } catch (error) {
    if (error instanceof CustomerPassportConfigurationError) {
      return serverError("Pasport ma'lumotlarini saqlash sozlanmagan. CUSTOMER_PII_ENCRYPTION_KEY va CUSTOMER_PII_SEARCH_KEY ni sozlang.")
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return conflict('Bu telefon yoki pasport bilan faol mijoz mavjud. Mavjud mijozni qidiruvdan tanlang.')
    }
    logger.error('[POST /api/customers]', { event: 'api.route_error', error })
    return serverError()
  }
}
