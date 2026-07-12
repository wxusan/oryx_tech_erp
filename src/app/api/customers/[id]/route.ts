import { NextRequest } from 'next/server'
import { z, ZodError } from 'zod'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/generated/prisma/client'
import { requireApiSession, resolveActiveShopId } from '@/lib/api-auth'
import { ok, badRequest, notFound, conflict, serverError } from '@/lib/api-helpers'
import { invalidateShopCustomerMutation } from '@/lib/server/cache-tags'
import { normalizePhone, normalizeAdditionalPhones } from '@/lib/phone'
import { phoneSchema } from '@/lib/validations'
import { logger } from '@/lib/logger'
import { computeCustomerTrustRating, isValidTrustTier, type CustomerNasiyaInput } from '@/lib/nasiya-customer-trust'

type RouteContext = { params: Promise<{ id: string }> }

const updateCustomerSchema = z.object({
  name: z.string().min(2).optional(),
  phone: phoneSchema.optional(),
  additionalPhones: z.array(z.string()).optional(),
  note: z.string().optional(),
  reason: z.string().optional(),
  shopId: z.string().optional(),
  trustOverride: z.enum(['NEW', 'LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH']).nullable().optional(),
})

export async function GET(_req: NextRequest, ctx: RouteContext) {
  try {
    const guarded = await requireApiSession()
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
        additionalPhones: true,
        note: true,
        createdAt: true,
        trustOverride: true,
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
    })
    if (!customer) return notFound('Mijoz topilmadi')

    const nasiyaInputs: CustomerNasiyaInput[] = customer.nasiya.map((n) => ({
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
    const override = isValidTrustTier(customer.trustOverride) ? customer.trustOverride : null
    const trust = computeCustomerTrustRating(nasiyaInputs, new Date(), override)

    const { nasiya, ...customerFields } = customer
    void nasiya
    return ok({ ...customerFields, trust }, "Mijoz ma'lumotlari")
  } catch (err) {
    logger.error('[GET /api/customers/[id]]', { event: 'api.route_error', error: err })
    return serverError()
  }
}

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  try {
    const guarded = await requireApiSession()
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

    const identityChanged =
      (parsed.data.name !== undefined && parsed.data.name !== existing.name) ||
      (parsed.data.phone !== undefined && parsed.data.phone !== existing.phone)
    const auditNote = parsed.data.reason?.trim() || parsed.data.note?.trim()
    let identityChangeReason: string | undefined
    if (identityChanged) {
      if (!auditNote) {
        return badRequest("Mijoz ismi yoki telefonini o'zgartirish uchun izoh yoki sabab kiritilishi shart")
      }
      if (auditNote.length < 5) {
        return badRequest("Mijoz ma'lumotlarini o'zgartirish sababi kamida 5 ta belgidan iborat bo'lishi kerak")
      }
      identityChangeReason = auditNote
    }

    const nextPrimaryPhone = parsed.data.phone !== undefined ? parsed.data.phone : existing.phone
    const customerUpdate = {
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.phone !== undefined
        ? { phone: parsed.data.phone, normalizedPhone: normalizePhone(parsed.data.phone) }
        : {}),
      ...(parsed.data.additionalPhones !== undefined
        ? { additionalPhones: normalizeAdditionalPhones(parsed.data.additionalPhones, nextPrimaryPhone) }
        : {}),
      ...(parsed.data.note !== undefined ? { note: parsed.data.note } : {}),
      // Item 12 — optional admin override of the computed trust tier; empty
      // string from a "no override" select option is normalized to null.
      ...(parsed.data.trustOverride !== undefined ? { trustOverride: parsed.data.trustOverride } : {}),
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
          additionalPhones: true,
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
            ...customerUpdate,
            ...(identityChangeReason ? { identityChangeReason } : {}),
          },
          note: identityChangeReason,
        },
      })
      return updated
    })

    invalidateShopCustomerMutation(resolved.shopId)

    return ok(customer, 'Mijoz yangilandi')
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return conflict('Bu telefon raqam bilan faol mijoz allaqachon mavjud')
    }
    logger.error('[PATCH /api/customers/[id]]', { event: 'api.route_error', error: err })
    return serverError()
  }
}
