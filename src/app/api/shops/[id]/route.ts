/**
 * GET    /api/shops/[id] — get a single shop (super admin only)
 * PATCH  /api/shops/[id] — update shop fields (super admin only)
 * DELETE /api/shops/[id] — soft-delete a shop with a required note (super admin only)
 */

import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/generated/prisma/client'
import { ok, badRequest, notFound, serverError } from '@/lib/api-helpers'
import { requireSuperAdmin } from '@/lib/api-auth'
import { shopAdminPublicSelect } from '@/lib/api-selects'
import { z, ZodError } from 'zod'

type RouteContext = { params: Promise<{ id: string }> }

// ---------------------------------------------------------------------------
// GET /api/shops/[id]
// ---------------------------------------------------------------------------

export async function GET(_req: NextRequest, ctx: RouteContext) {
  try {
    const guarded = await requireSuperAdmin()
    if (!guarded.ok) return guarded.response

    const { id } = await ctx.params

    const shop = await prisma.shop.findFirst({
      where: { id, deletedAt: null },
      include: {
        admins: { where: { deletedAt: null }, select: shopAdminPublicSelect },
        payments: { where: { deletedAt: null }, orderBy: { paidAt: 'desc' } },
        _count: { select: { devices: true, nasiya: true, sales: true } },
      },
    })

    if (!shop) return notFound("Do'kon topilmadi")

    return ok(shop)
  } catch (err) {
    console.error('[GET /api/shops/[id]]', err)
    return serverError()
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/shops/[id]
// ---------------------------------------------------------------------------

const updateShopSchema = z.object({
  name: z.string().min(2).optional(),
  ownerName: z.string().min(2).optional(),
  ownerPhone: z.string().min(9).optional(),
  shopNumber: z.string().min(1).optional(),
  address: z.string().optional(),
  note: z.string().optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
  telegramGroupId: z.string().optional(),
})

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  try {
    const guarded = await requireSuperAdmin()
    if (!guarded.ok) return guarded.response
    const { session } = guarded

    const { id } = await ctx.params
    const body: unknown = await req.json()
    const parsed = updateShopSchema.safeParse(body)

    if (!parsed.success) {
      const firstError = (parsed.error as ZodError).issues[0]?.message ?? "Noto'g'ri ma'lumot"
      return badRequest(firstError)
    }

    const existing = await prisma.shop.findFirst({ where: { id, deletedAt: null } })
    if (!existing) return notFound("Do'kon topilmadi")

    const updated = await prisma.shop.update({
      where: { id },
      data: parsed.data,
    })

    await prisma.log.create({
      data: {
        shopId: id,
        actorId: session.user.id,
        actorType: 'SUPER_ADMIN',
        action: 'UPDATE',
        targetType: 'Shop',
        targetId: id,
        oldValue: existing as object,
        newValue: parsed.data as object,
      },
    })

    return ok(updated, "Do'kon muvaffaqiyatli yangilandi")
  } catch (err) {
    console.error('[PATCH /api/shops/[id]]', err)
    return serverError()
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/shops/[id]
// ---------------------------------------------------------------------------

const deleteShopSchema = z.object({
  deleteNote: z
    .string({ error: "O'chirish sababi kiritilishi shart" })
    .min(5, "O'chirish sababi kamida 5 ta belgidan iborat bo'lishi kerak"),
})

export async function DELETE(req: NextRequest, ctx: RouteContext) {
  try {
    const guarded = await requireSuperAdmin()
    if (!guarded.ok) return guarded.response
    const { session } = guarded

    const { id } = await ctx.params
    const body: unknown = await req.json()
    const parsed = deleteShopSchema.safeParse(body)

    if (!parsed.success) {
      const firstError = (parsed.error as ZodError).issues[0]?.message ?? "O'chirish sababi kiritilishi shart"
      return badRequest(firstError)
    }

    const { deleteNote } = parsed.data

    const existing = await prisma.shop.findFirst({ where: { id, deletedAt: null } })
    if (!existing) return notFound("Do'kon topilmadi")

    const deleted = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const shop = await tx.shop.update({
        where: { id },
        data: {
          status: 'DELETED',
          deletedAt: new Date(),
          deletedBy: session.user.id,
          deleteNote,
        },
      })

      await tx.log.create({
        data: {
          shopId: id,
          actorId: session.user.id,
          actorType: 'SUPER_ADMIN',
          action: 'DELETE',
          targetType: 'Shop',
          targetId: id,
          note: deleteNote,
        },
      })

      return shop
    })

    return ok(deleted, "Do'kon muvaffaqiyatli o'chirildi")
  } catch (err) {
    console.error('[DELETE /api/shops/[id]]', err)
    return serverError()
  }
}
