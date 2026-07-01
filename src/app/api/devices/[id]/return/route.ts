import { NextRequest } from 'next/server'
import { z, ZodError } from 'zod'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/generated/prisma/client'
import { requireApiSession, resolveActiveShopId } from '@/lib/api-auth'
import { ok, badRequest, notFound, conflict, serverError } from '@/lib/api-helpers'

type RouteContext = { params: Promise<{ id: string }> }

const returnDeviceSchema = z.object({
  note: z.string({ error: 'Sabab kiritilishi shart' }).min(5, 'Sabab kamida 5 ta belgidan iborat bo\'lishi kerak'),
  shopId: z.string().optional(),
})

export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const guarded = await requireApiSession()
    if (!guarded.ok) return guarded.response
    const { session } = guarded

    const { id: deviceId } = await ctx.params
    const body: unknown = await req.json()
    const parsed = returnDeviceSchema.safeParse(body)
    if (!parsed.success) {
      const firstError = (parsed.error as ZodError).issues[0]?.message ?? "Noto'g'ri ma'lumot"
      return badRequest(firstError)
    }

    const resolved = await resolveActiveShopId(session, parsed.data.shopId)
    if (!resolved.ok) return resolved.response
    const { shopId } = resolved

    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const device = await tx.device.findFirst({
        where: { id: deviceId, shopId, deletedAt: null },
        include: {
          sales: { where: { deletedAt: null }, orderBy: { createdAt: 'desc' }, take: 1 },
          nasiya: { where: { deletedAt: null, status: { not: 'CANCELLED' } }, orderBy: { createdAt: 'desc' }, take: 1 },
        },
      })
      if (!device) throw { status: 404, message: 'Qurilma topilmadi' }
      if (!['SOLD_CASH', 'SOLD_NASIYA'].includes(device.status)) {
        throw { status: 409, message: 'Faqat sotilgan qurilmani qaytarish mumkin' }
      }

      const returned = await tx.device.update({
        where: { id: deviceId },
        data: { status: 'RETURNED', updatedAt: new Date(), note: parsed.data.note },
      })

      const sale = device.sales[0]
      if (sale) {
        await tx.sale.update({
          where: { id: sale.id },
          data: {
            deletedAt: new Date(),
            deletedBy: session.user.id,
            deleteNote: `RETURN: ${parsed.data.note}`,
          },
        })
      }

      const nasiya = device.nasiya[0]
      if (nasiya) {
        await tx.nasiya.update({
          where: { id: nasiya.id },
          data: {
            status: 'CANCELLED',
            deletedAt: new Date(),
            deletedBy: session.user.id,
            deleteNote: `RETURN: ${parsed.data.note}`,
          },
        })
        await tx.nasiyaSchedule.updateMany({
          where: { nasiyaId: nasiya.id, shopId, status: { not: 'PAID' } },
          data: { status: 'DEFERRED', note: `Bekor qilindi: ${parsed.data.note}` },
        })
      }

      await tx.log.create({
        data: {
          shopId,
          actorId: session.user.id,
          actorType: session.user.role as 'SUPER_ADMIN' | 'SHOP_ADMIN',
          action: 'RETURN',
          targetType: 'Device',
          targetId: deviceId,
          oldValue: { status: device.status, saleId: sale?.id, nasiyaId: nasiya?.id },
          newValue: { status: 'RETURNED', note: parsed.data.note },
          note: parsed.data.note,
        },
      })

      return returned
    })

    return ok(result, 'Qurilma qaytarildi va bog\'langan sotuv/nasiya bekor qilindi')
  } catch (err: unknown) {
    if (typeof err === 'object' && err !== null && 'status' in err) {
      const e = err as { status: number; message: string }
      if (e.status === 404) return notFound(e.message)
      if (e.status === 409) return conflict(e.message)
    }
    console.error('[POST /api/devices/[id]/return]', err)
    return serverError()
  }
}
