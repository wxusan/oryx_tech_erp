/**
 * GET    /api/devices/[id] — fetch a single device with supplier, sale, nasiya info
 * PATCH  /api/devices/[id] — update device fields (model, color, storage, batteryHealth, note)
 * DELETE /api/devices/[id] — soft-delete a device (requires deleteNote)
 *
 * All routes require SHOP_ADMIN (or SUPER_ADMIN) authentication.
 * Shop admins can only access devices belonging to their own shop.
 */

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { requireApiSession } from '@/lib/api-auth'
import { ok, badRequest, notFound, serverError } from '@/lib/api-helpers'
import { invalidateShopDeviceMutation } from '@/lib/server/cache-tags'
import type { ZodError } from 'zod'

type RouteContext = { params: Promise<{ id: string }> }

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const updateDeviceSchema = z.object({
  model: z.string().min(1).optional(),
  color: z.string().optional(),
  storage: z.string().optional(),
  batteryHealth: z.number().optional(),
  note: z.string().optional(),
  reason: z.string().optional(),
})

const deleteDeviceSchema = z.object({
  deleteNote: z.string().min(5, "O'chirish sababi kamida 5 ta belgi bo'lishi kerak"),
})

// ---------------------------------------------------------------------------
// GET /api/devices/[id]
// ---------------------------------------------------------------------------

export async function GET(_req: NextRequest, ctx: RouteContext) {
  try {
    const guarded = await requireApiSession()
    if (!guarded.ok) return guarded.response
    const { session } = guarded

    const { id: deviceId } = await ctx.params

    const device = await prisma.device.findFirst({
      where: {
        id: deviceId,
        deletedAt: null,
        shop: { status: 'ACTIVE', deletedAt: null },
        ...(session.user.role === 'SHOP_ADMIN' ? { shopId: session.user.shopId ?? '' } : {}),
      },
      include: {
        supplier: {
          select: {
            name: true,
            phone: true,
          },
        },
        sales: {
            where: { deletedAt: null },
            select: {
              id: true,
              salePrice: true,
              amountPaid: true,
              remainingAmount: true,
              dueDate: true,
              paidFully: true,
              paymentMethod: true,
              createdAt: true,
              customer: {
                select: { name: true, phone: true },
              },
            },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        nasiya: {
          where: { deletedAt: null, status: { not: 'CANCELLED' } },
          select: {
            id: true,
            totalAmount: true,
            finalNasiyaAmount: true,
            remainingAmount: true,
            customer: {
              select: { name: true, phone: true },
            },
            schedules: {
              orderBy: { monthNumber: 'asc' },
              select: {
                id: true,
                monthNumber: true,
                dueDate: true,
                expectedAmount: true,
                status: true,
              },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    })

    if (!device) return notFound("Qurilma topilmadi")

    return ok(device, "Qurilma ma'lumotlari")
  } catch (err) {
    console.error('[GET /api/devices/[id]]', err)
    return serverError()
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/devices/[id]
// ---------------------------------------------------------------------------

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  try {
    const guarded = await requireApiSession()
    if (!guarded.ok) return guarded.response
    const { session } = guarded

    const { id: deviceId } = await ctx.params
    const body: unknown = await req.json()
    const parsed = updateDeviceSchema.safeParse(body)

    if (!parsed.success) {
      const firstError = (parsed.error as ZodError).issues[0]?.message ?? "Noto'g'ri ma'lumot"
      return badRequest(firstError)
    }

    const existing = await prisma.device.findFirst({
      where: {
        id: deviceId,
        deletedAt: null,
        shop: { status: 'ACTIVE', deletedAt: null },
        ...(session.user.role === 'SHOP_ADMIN' ? { shopId: session.user.shopId ?? '' } : {}),
      },
    })

    if (!existing) return notFound("Qurilma topilmadi")

    const { reason, ...updateData } = parsed.data
    const hasDeviceChanges = Object.entries(updateData).some(([key, value]) => {
      if (value === undefined) return false
      return existing[key as keyof typeof existing] !== value
    })

    const [saleCount, nasiyaCount] = await prisma.$transaction([
      prisma.sale.count({ where: { deviceId, deletedAt: null } }),
      prisma.nasiya.count({ where: { deviceId, deletedAt: null } }),
    ])
    const isFinanciallyLinked =
      ['SOLD_CASH', 'SOLD_NASIYA'].includes(existing.status) || saleCount > 0 || nasiyaCount > 0
    const auditNote = reason?.trim() || updateData.note?.trim()
    if (hasDeviceChanges && isFinanciallyLinked) {
      if (!auditNote) {
        return badRequest(
          "Sotilgan yoki nasiya qurilma ma'lumotlarini o'zgartirish uchun izoh yoki sabab kiritilishi shart",
        )
      }
      if (auditNote.length < 5) {
        return badRequest("Qurilma ma'lumotlarini o'zgartirish sababi kamida 5 ta belgidan iborat bo'lishi kerak")
      }
    }

    const device = await prisma.$transaction(async (tx) => {
      const updatedDevice = await tx.device.update({
        where: { id: deviceId },
        data: {
          ...updateData,
          updatedAt: new Date(),
        },
      })

      await tx.log.create({
        data: {
          shopId: existing.shopId,
          actorId: session.user.id,
          actorType: session.user.role as 'SUPER_ADMIN' | 'SHOP_ADMIN',
          action: 'UPDATE',
          targetType: 'Device',
          targetId: deviceId,
          oldValue: {
            model: existing.model,
            color: existing.color,
            storage: existing.storage,
            batteryHealth: existing.batteryHealth,
            note: existing.note,
          },
          newValue: {
            ...updateData,
            ...(auditNote && isFinanciallyLinked ? { editReason: auditNote } : {}),
          },
          note: auditNote && isFinanciallyLinked ? auditNote : undefined,
        },
      })

      return updatedDevice
    })

    invalidateShopDeviceMutation(existing.shopId)

    return ok(device, "Qurilma muvaffaqiyatli yangilandi")
  } catch (err) {
    console.error('[PATCH /api/devices/[id]]', err)
    return serverError()
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/devices/[id]
// ---------------------------------------------------------------------------

export async function DELETE(req: NextRequest, ctx: RouteContext) {
  try {
    const guarded = await requireApiSession()
    if (!guarded.ok) return guarded.response
    const { session } = guarded

    const { id: deviceId } = await ctx.params
    const body: unknown = await req.json()
    const parsed = deleteDeviceSchema.safeParse(body)

    if (!parsed.success) {
      const firstError = (parsed.error as ZodError).issues[0]?.message ?? "Noto'g'ri ma'lumot"
      return badRequest(firstError)
    }

    const { deleteNote } = parsed.data

    const existing = await prisma.device.findFirst({
      where: {
        id: deviceId,
        deletedAt: null,
        shop: { status: 'ACTIVE', deletedAt: null },
        ...(session.user.role === 'SHOP_ADMIN' ? { shopId: session.user.shopId ?? '' } : {}),
      },
    })

    if (!existing) return notFound("Qurilma topilmadi")
    if (['SOLD_CASH', 'SOLD_NASIYA'].includes(existing.status)) {
      return badRequest(
        "Sotilgan yoki nasiya qilingan qurilmani bevosita o'chirib bo'lmaydi. Qaytarish yoki bekor qilish jarayonidan foydalaning.",
      )
    }

    const [saleCount, nasiyaCount] = await prisma.$transaction([
      prisma.sale.count({ where: { deviceId, deletedAt: null } }),
      prisma.nasiya.count({ where: { deviceId, deletedAt: null } }),
    ])
    if (saleCount > 0 || nasiyaCount > 0) {
      return badRequest(
        "Bu qurilmaga bog'langan sotuv yoki nasiya mavjud. O'chirish uchun qaytarish yoki bekor qilish jarayonidan foydalaning.",
      )
    }

    const device = await prisma.$transaction(async (tx) => {
      const deletedDevice = await tx.device.update({
        where: { id: deviceId },
        data: {
          deletedAt: new Date(),
          deletedBy: session.user.id,
          deleteNote,
          status: 'DELETED',
          updatedAt: new Date(),
        },
      })

      await tx.log.create({
        data: {
          shopId: existing.shopId,
          actorId: session.user.id,
          actorType: session.user.role as 'SUPER_ADMIN' | 'SHOP_ADMIN',
          action: 'DELETE',
          targetType: 'Device',
          targetId: deviceId,
          oldValue: { status: existing.status, deletedAt: existing.deletedAt },
          newValue: { deleteNote, status: 'DELETED' },
          note: deleteNote,
        },
      })

      return deletedDevice
    })

    invalidateShopDeviceMutation(existing.shopId)

    return ok(device, "Qurilma muvaffaqiyatli o'chirildi")
  } catch (err) {
    console.error('[DELETE /api/devices/[id]]', err)
    return serverError()
  }
}
