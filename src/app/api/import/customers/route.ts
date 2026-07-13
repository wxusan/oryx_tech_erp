import { NextRequest } from 'next/server'
import { z, ZodError } from 'zod'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/generated/prisma/client'
import { requireShopPermissionAndFeature, resolveActiveShopId } from '@/lib/api-auth'
import { ok, badRequest, conflict, serverError, tooManyRequests } from '@/lib/api-helpers'
import { normalizePhone } from '@/lib/phone'
import { phoneSchema } from '@/lib/validations'
import { logger } from '@/lib/logger'
import { rateLimitKey } from '@/lib/rate-limit'
import { checkRateLimitDistributed } from '@/lib/rate-limit-adapter'
import { invalidateShopCustomerMutation } from '@/lib/server/cache-tags'

const customerImportSchema = z.object({
  shopId: z.string().optional(),
  customers: z.array(z.object({
    name: z.string().min(2),
    phone: phoneSchema,
    note: z.string().optional(),
  })).min(1).max(500),
})

export async function POST(req: NextRequest) {
  try {
    const guarded = await requireShopPermissionAndFeature('IMPORT_DATA', 'CUSTOMER_CRM')
    if (!guarded.ok) return guarded.response
    const { session } = guarded

    const body: unknown = await req.json()
    const parsed = customerImportSchema.safeParse(body)
    if (!parsed.success) {
      const firstError = (parsed.error as ZodError).issues[0]?.message ?? "Noto'g'ri ma'lumot"
      return badRequest(firstError)
    }

    const resolved = await resolveActiveShopId(session, parsed.data.shopId)
    if (!resolved.ok) return resolved.response

    // Distributed when Upstash is configured; bounded in-process fallback otherwise.
    const rate = await checkRateLimitDistributed(rateLimitKey('customer-import', resolved.shopId, session.user.id), { windowMs: 60_000, max: 10 })
    if (!rate.allowed) return tooManyRequests(rate.retryAfterSeconds)

    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      let created = 0
      let updated = 0

      for (const item of parsed.data.customers) {
        const phone = item.phone.trim()
        const normalizedPhone = normalizePhone(phone)
        const existing = await tx.customer.findFirst({
          where: {
            shopId: resolved.shopId,
            deletedAt: null,
            OR: [
              ...(normalizedPhone ? [{ normalizedPhone }] : []),
              { phone },
            ],
          },
          select: { id: true },
        })

        if (existing) {
          updated += 1
          await tx.customer.update({
            where: { id: existing.id },
            data: { name: item.name.trim(), normalizedPhone, note: item.note },
          })
        } else {
          created += 1
          await tx.customer.create({
            data: {
              shopId: resolved.shopId,
              name: item.name.trim(),
              phone,
              normalizedPhone,
              note: item.note,
            },
          })
        }
      }

      await tx.log.create({
        data: {
          shopId: resolved.shopId,
          actorId: session.user.id,
          actorType: session.user.role as 'SUPER_ADMIN' | 'SHOP_ADMIN',
          action: 'IMPORT',
          targetType: 'Customer',
          targetId: resolved.shopId,
          newValue: { created, updated, total: parsed.data.customers.length },
        },
      })

      return { created, updated, total: parsed.data.customers.length }
    })

    invalidateShopCustomerMutation(resolved.shopId)
    return ok(result, 'Mijozlar import qilindi')
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return conflict('Import ichida takrorlangan faol telefon raqam bor')
    }
    logger.error('[POST /api/import/customers]', { event: 'api.route_error', error: err })
    return serverError()
  }
}
