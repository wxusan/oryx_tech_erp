import { NextRequest } from 'next/server'
import { z, ZodError } from 'zod'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/generated/prisma/client'
import { requireApiSession, resolveActiveShopId } from '@/lib/api-auth'
import { ok, badRequest, conflict, serverError } from '@/lib/api-helpers'
import { normalizePhone } from '@/lib/phone'

const customerImportSchema = z.object({
  shopId: z.string().optional(),
  customers: z.array(z.object({
    name: z.string().min(2),
    phone: z.string().min(9),
    note: z.string().optional(),
  })).min(1).max(500),
})

export async function POST(req: NextRequest) {
  try {
    const guarded = await requireApiSession()
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

    return ok(result, 'Mijozlar import qilindi')
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return conflict('Import ichida takrorlangan faol telefon raqam bor')
    }
    console.error('[POST /api/import/customers]', err)
    return serverError()
  }
}
