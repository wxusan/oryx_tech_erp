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

    const customer = await prisma.customer.update({
      where: { id },
      data: {
        name: parsed.data.name,
        phone: parsed.data.phone,
        note: parsed.data.note,
      },
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
        newValue: parsed.data,
      },
    })

    return ok(customer, 'Mijoz yangilandi')
  } catch (err) {
    console.error('[PATCH /api/customers/[id]]', err)
    return serverError()
  }
}
