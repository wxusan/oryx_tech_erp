import { NextRequest } from 'next/server'
import { z, ZodError } from 'zod'
import { prisma } from '@/lib/prisma'
import { requireApiSession, resolveActiveShopId } from '@/lib/api-auth'
import { ok, badRequest, notFound, serverError } from '@/lib/api-helpers'

type RouteContext = { params: Promise<{ id: string }> }

const updateCustomerSchema = z.object({
  name: z.string().min(2).optional(),
  phone: z.string().min(9).optional(),
  note: z.string().optional(),
  reason: z.string().optional(),
  shopId: z.string().optional(),
})

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

    const customerUpdate = {
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.phone !== undefined ? { phone: parsed.data.phone } : {}),
      ...(parsed.data.note !== undefined ? { note: parsed.data.note } : {}),
    }

    const customer = await prisma.customer.update({
      where: { id },
      data: customerUpdate,
      select: {
        id: true,
        shopId: true,
        name: true,
        phone: true,
        note: true,
        createdAt: true,
      },
    })

    await prisma.log.create({
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

    return ok(customer, 'Mijoz yangilandi')
  } catch (err) {
    console.error('[PATCH /api/customers/[id]]', err)
    return serverError()
  }
}
