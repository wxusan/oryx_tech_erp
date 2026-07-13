import { NextRequest } from 'next/server'
import { z, ZodError } from 'zod'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/generated/prisma/client'
import { requireShopPermission, resolveActiveShopId } from '@/lib/api-auth'
import { ok, badRequest, notFound, conflict, serverError } from '@/lib/api-helpers'
import { invalidateShopCustomerMutation } from '@/lib/server/cache-tags'
import { normalizePhone, normalizeAdditionalPhones } from '@/lib/phone'
import { phoneSchema } from '@/lib/validations'
import { logger } from '@/lib/logger'
import { computeCustomerTrustRating, isValidTrustTier, type CustomerNasiyaInput } from '@/lib/nasiya-customer-trust'
import { isValidPassportIdentifier, passportIdentifierStorage } from '@/lib/customer-passport'
import { resolvePrivateUploadReference } from '@/lib/server/private-upload-reference'

type RouteContext = { params: Promise<{ id: string }> }

const updateCustomerSchema = z.object({
  name: z.string().min(2).optional(),
  phone: phoneSchema.optional(),
  additionalPhones: z.array(z.string()).optional(),
  // An ordinary profile note must never block a contact update. A submitted
  // blank deliberately clears the nullable field instead of storing `''`.
  note: z.string().trim().max(1000, "Izoh 1000 ta belgidan oshmasligi kerak").optional().transform((value) => value === undefined ? undefined : value || null),
  reason: z.string().trim().max(1000, "Sabab 1000 ta belgidan oshmasligi kerak").optional().transform((value) => value || undefined),
  shopId: z.string().optional(),
  trustOverride: z.enum(['NEW', 'LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH']).nullable().optional(),
  passportIdentifier: z.string().trim().max(64).refine(isValidPassportIdentifier, "Pasport seriya/raqami noto'g'ri").nullable().optional(),
  passportPhotoUrl: z.string().max(500).nullable().optional(),
})

export async function GET(_req: NextRequest, ctx: RouteContext) {
  try {
    const guarded = await requireShopPermission('CUSTOMER_VIEW')
    if (!guarded.ok) return guarded.response
    const { session } = guarded

    const { id } = await ctx.params
    const resolved = await resolveActiveShopId(session, null)
    if (!resolved.ok) return resolved.response

    const customer = await prisma.customer.findFirst({
      where: { id, shopId: resolved.shopId, deletedAt: null },
      select: {
        id: true,
        shopId: true,
        name: true,
        phone: true,
        phoneNormalizationNeedsReview: true,
        additionalPhones: true,
        passportIdentifierLast4: true,
        passportPhotoUrl: true,
        note: true,
        createdAt: true,
        trustOverride: true,
        nasiya: {
          where: { deletedAt: null },
          select: {
            status: true,
            resolutionState: true,
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
    if (!customer) return notFound('Mijoz topilmadi')

    const nasiyaInputs: CustomerNasiyaInput[] = customer.nasiya.map((n) => ({
      status: n.status,
      resolutionState: n.resolutionState,
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

    const { nasiya, ...customerFields } = customer
    void nasiya
    return ok({
      ...customerFields,
      passportMasked: customerFields.passportIdentifierLast4 ? `••••${customerFields.passportIdentifierLast4}` : null,
      hasPassportPhoto: Boolean(customerFields.passportPhotoUrl),
      passportIdentifierLast4: undefined,
      passportPhotoUrl: undefined,
      trust,
    }, "Mijoz ma'lumotlari")
  } catch (err) {
    logger.error('[GET /api/customers/[id]]', { event: 'api.route_error', error: err })
    return serverError()
  }
}

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  try {
    const guarded = await requireShopPermission('CUSTOMER_MANAGE')
    if (!guarded.ok) return guarded.response
    const { session } = guarded

    const { id } = await ctx.params
    const body: unknown = await req.json()
    const parsed = updateCustomerSchema.safeParse(body)
    if (!parsed.success) {
      const firstError = (parsed.error as ZodError).issues[0]?.message ?? "Noto'g'ri ma'lumot"
      return badRequest(firstError)
    }

    const resolved = await resolveActiveShopId(session, parsed.data.shopId)
    if (!resolved.ok) return resolved.response

    const existing = await prisma.customer.findFirst({
      where: { id, shopId: resolved.shopId, deletedAt: null },
    })
    if (!existing) return notFound('Mijoz topilmadi')
    const passportPhotoKey = parsed.data.passportPhotoUrl === undefined
      ? undefined
      : parsed.data.passportPhotoUrl === null
        ? null
        : resolvePrivateUploadReference({
            value: parsed.data.passportPhotoUrl,
            shopId: resolved.shopId,
            kind: 'passport',
            allowLegacyRawKey: true,
          })
    if (parsed.data.passportPhotoUrl && !passportPhotoKey) {
      return badRequest("Pasport rasmi boshqa do'konga tegishli yoki havola muddati tugagan")
    }

    const auditNote = parsed.data.reason ?? (typeof parsed.data.note === 'string' ? parsed.data.note : undefined)

    const nextPrimaryPhone = parsed.data.phone !== undefined ? parsed.data.phone : existing.phone
    const passportUpdate = parsed.data.passportIdentifier === undefined
      ? {}
      : parsed.data.passportIdentifier === null
        ? {
            passportIdentifierCiphertext: null,
            passportIdentifierHash: null,
            passportIdentifierLast4: null,
            passportIdentifierKeyVersion: null,
          }
        : passportIdentifierStorage(parsed.data.passportIdentifier)
    const customerUpdate = {
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.phone !== undefined
        ? { phone: parsed.data.phone, normalizedPhone: normalizePhone(parsed.data.phone), phoneNormalizationNeedsReview: false }
        : {}),
      ...(parsed.data.additionalPhones !== undefined
        ? { additionalPhones: normalizeAdditionalPhones(parsed.data.additionalPhones, nextPrimaryPhone) }
        : {}),
      ...(parsed.data.note !== undefined ? { note: parsed.data.note } : {}),
      // Item 12 — optional admin override of the computed trust tier; empty
      // string from a "no override" select option is normalized to null.
      ...(parsed.data.trustOverride !== undefined ? { trustOverride: parsed.data.trustOverride } : {}),
      ...(passportPhotoKey !== undefined ? { passportPhotoUrl: passportPhotoKey } : {}),
      ...passportUpdate,
    }

    const customer = await prisma.$transaction(async (tx) => {
      const updated = await tx.customer.update({
        where: { id },
        data: customerUpdate,
        select: {
          id: true,
          shopId: true,
          name: true,
          phone: true,
          phoneNormalizationNeedsReview: true,
          additionalPhones: true,
          passportIdentifierLast4: true,
          passportPhotoUrl: true,
          trustOverride: true,
          note: true,
          createdAt: true,
        },
      })
      await tx.log.create({
        data: {
          shopId: resolved.shopId,
          actorId: session.user.id,
          actorType: session.user.role as 'SUPER_ADMIN' | 'SHOP_ADMIN',
          action: 'UPDATE',
          targetType: 'Customer',
          targetId: id,
          oldValue: { name: existing.name, phone: existing.phone, note: existing.note },
          newValue: {
            ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
            ...(parsed.data.phone !== undefined ? { phone: parsed.data.phone } : {}),
            ...(parsed.data.additionalPhones !== undefined ? { additionalPhoneCount: updated.additionalPhones.length } : {}),
            ...(parsed.data.note !== undefined ? { note: parsed.data.note } : {}),
            ...(parsed.data.trustOverride !== undefined ? { trustOverride: parsed.data.trustOverride } : {}),
            ...(parsed.data.passportIdentifier !== undefined
              ? { passportIdentifierChanged: true, passportMasked: updated.passportIdentifierLast4 ? `••••${updated.passportIdentifierLast4}` : null }
              : {}),
            ...(parsed.data.passportPhotoUrl !== undefined ? { hasPassportPhoto: Boolean(updated.passportPhotoUrl) } : {}),
            ...(auditNote ? { editNote: auditNote } : {}),
          },
          note: auditNote,
        },
      })
      return {
        ...updated,
        passportMasked: updated.passportIdentifierLast4 ? `••••${updated.passportIdentifierLast4}` : null,
        hasPassportPhoto: Boolean(updated.passportPhotoUrl),
        passportIdentifierLast4: undefined,
        passportPhotoUrl: undefined,
      }
    })

    invalidateShopCustomerMutation(resolved.shopId)

    return ok(customer, 'Mijoz yangilandi')
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return conflict('Bu telefon yoki pasport bilan faol mijoz allaqachon mavjud')
    }
    logger.error('[PATCH /api/customers/[id]]', { event: 'api.route_error', error: err })
    return serverError()
  }
}
