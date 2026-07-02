/**
 * POST /api/devices/[id]/restock — return a RETURNED device back into stock.
 *
 * Lifecycle: IN_STOCK -> SOLD_CASH/SOLD_NASIYA -> RETURNED -> IN_STOCK (here).
 *
 * Only a device that is currently RETURNED (and belongs to the caller's shop,
 * not soft-deleted) can be restocked. The status flip is guarded atomically so
 * two concurrent restocks can't both succeed. A required note (>= 5 chars) is
 * captured and an audit log row is written.
 */

import { NextRequest } from 'next/server'
import { z, ZodError } from 'zod'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/generated/prisma/client'
import { requireApiSession, resolveActiveShopId } from '@/lib/api-auth'
import { ok, badRequest, notFound, conflict, serverError } from '@/lib/api-helpers'
import { invalidateShopDeviceMutation } from '@/lib/server/cache-tags'

type RouteContext = { params: Promise<{ id: string }> }

const restockDeviceSchema = z.object({
  note: z
    .string({ error: 'Sabab kiritilishi shart' })
    .min(5, "Sabab kamida 5 ta belgidan iborat bo'lishi kerak"),
  shopId: z.string().optional(),
})

export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const guarded = await requireApiSession()
    if (!guarded.ok) return guarded.response
    const { session } = guarded

    const { id: deviceId } = await ctx.params
    const body: unknown = await req.json()
    const parsed = restockDeviceSchema.safeParse(body)
    if (!parsed.success) {
      const firstError = (parsed.error as ZodError).issues[0]?.message ?? "Noto'g'ri ma'lumot"
      return badRequest(firstError)
    }

    // For shop admins this ignores any client-supplied shopId and forces the
    // session shop; only super admins may pass an explicit shopId.
    const resolved = await resolveActiveShopId(session, parsed.data.shopId)
    if (!resolved.ok) return resolved.response
    const { shopId } = resolved

    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const device = await tx.device.findFirst({
        where: { id: deviceId, shopId, deletedAt: null },
      })
      if (!device) throw { status: 404, message: 'Qurilma topilmadi' }
      if (device.status !== 'RETURNED') {
        throw { status: 409, message: 'Faqat qaytarilgan qurilmani omborga qaytarish mumkin.' }
      }

      // Atomic guard: only flip if it is still RETURNED (prevents double-restock races).
      const restocked = await tx.device.updateMany({
        where: { id: deviceId, shopId, deletedAt: null, status: 'RETURNED' },
        data: { status: 'IN_STOCK', updatedAt: new Date(), note: parsed.data.note },
      })
      if (restocked.count !== 1) {
        throw { status: 409, message: 'Faqat qaytarilgan qurilmani omborga qaytarish mumkin.' }
      }

      await tx.log.create({
        data: {
          shopId,
          actorId: session.user.id,
          actorType: session.user.role as 'SUPER_ADMIN' | 'SHOP_ADMIN',
          action: 'RESTOCK',
          targetType: 'Device',
          targetId: deviceId,
          oldValue: { status: 'RETURNED' },
          newValue: { status: 'IN_STOCK' },
          note: parsed.data.note,
        },
      })

      return tx.device.findFirst({ where: { id: deviceId, shopId } })
    })

    invalidateShopDeviceMutation(shopId)

    return ok(result, "Qurilma omborga qaytarildi va sotuvga tayyor")
  } catch (err: unknown) {
    if (typeof err === 'object' && err !== null && 'status' in err) {
      const e = err as { status: number; message: string }
      if (e.status === 404) return notFound(e.message)
      if (e.status === 409) return conflict(e.message)
    }
    console.error('[POST /api/devices/[id]/restock]', err)
    return serverError()
  }
}
