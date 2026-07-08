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
import { ok, badRequest, conflict, notFound, serverError } from '@/lib/api-helpers'
import { invalidateShopDeviceMutation } from '@/lib/server/cache-tags'
import { moneyInputToUzs, moneyInputMeta } from '@/lib/server/money-input'
import { Prisma } from '@/generated/prisma/client'
import type { ZodError } from 'zod'
import { logger } from '@/lib/logger'

type RouteContext = { params: Promise<{ id: string }> }

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const updateDeviceSchema = z.object({
  model: z.string().min(1).optional(),
  color: z.string().optional(),
  storage: z.string().optional(),
  batteryHealth: z.number().int().min(0).max(100).optional(),
  purchasePrice: z.number().positive("Kelish narxi 0 dan katta bo'lishi kerak").optional(),
  // Display/input currency of purchasePrice. UZS by default (back-compatible);
  // USD is converted to UZS server-side — UZS remains the stored value.
  inputCurrency: z.enum(['UZS', 'USD']).optional(),
  imei: z.string().trim().min(1, 'IMEI kiritilishi shart').optional(),
  supplierPhone: z.string().trim().optional(),
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
              reminderEnabled: true,
              paidFully: true,
              paymentMethod: true,
              note: true,
              createdAt: true,
              customer: {
                select: { name: true, phone: true },
              },
              // Native contract-currency ledger — see docs/currency-accounting-model.md.
              contractCurrency: true,
              contractSalePrice: true,
              contractAmountPaid: true,
              contractRemainingAmount: true,
              contractExchangeRateAtCreation: true,
              payments: {
                where: { deletedAt: null },
                select: {
                  id: true,
                  amount: true,
                  paymentMethod: true,
                  paidAt: true,
                  note: true,
                  paymentInputAmount: true,
                  paymentInputCurrency: true,
                  paymentExchangeRate: true,
                  appliedAmountInContractCurrency: true,
                },
                orderBy: { paidAt: 'asc' },
              },
            },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        returns: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            refundAmount: true,
            refundMethod: true,
            note: true,
            createdAt: true,
          },
        },
        nasiya: {
          where: { deletedAt: null, status: { not: 'CANCELLED' } },
          select: {
            id: true,
            totalAmount: true,
            interestPercent: true,
            interestAmount: true,
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
    logger.error('[GET /api/devices/[id]]', { event: 'api.route_error', error: err })
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

    const { reason, inputCurrency, ...updateData } = parsed.data
    const hasDeviceChanges = Object.entries(updateData).some(([key, value]) => {
      if (value === undefined) return false
      return String(existing[key as keyof typeof existing] ?? '') !== String(value)
    })

    const [saleCount, nasiyaCount] = await prisma.$transaction([
      prisma.sale.count({ where: { deviceId, deletedAt: null } }),
      prisma.nasiya.count({ where: { deviceId, deletedAt: null } }),
    ])
    const isFinanciallyLinked =
      ['SOLD_CASH', 'SOLD_NASIYA'].includes(existing.status) || saleCount > 0 || nasiyaCount > 0

    // Money is locked once a device is sold / nasiya'd — the purchase price feeds
    // profit reporting and must not be silently rewritten after the fact.
    if (isFinanciallyLinked && updateData.purchasePrice !== undefined) {
      return badRequest("Sotilgan yoki nasiya qurilmaning kelish narxini o'zgartirib bo'lmaydi")
    }

    // Convert the entered purchase price to the UZS base. UZS passes through;
    // USD is converted with the current rate. UZS is what gets stored.
    let purchaseMeta: Awaited<ReturnType<typeof moneyInputToUzs>> | null = null
    const rawPurchasePriceInput = updateData.purchasePrice
    if (updateData.purchasePrice !== undefined) {
      try {
        purchaseMeta = await moneyInputToUzs(updateData.purchasePrice, inputCurrency)
        updateData.purchasePrice = purchaseMeta.amountUzs
      } catch {
        return badRequest("USD kursi mavjud emas. UZS rejimida kiriting yoki keyinroq urinib ko'ring.")
      }
    }

    // IMEI uniqueness among the shop's ACTIVE devices (mirrors the DB partial
    // unique index). A blank/duplicate IMEI would corrupt device identity.
    const imeiChanged = updateData.imei !== undefined && updateData.imei !== existing.imei
    if (imeiChanged) {
      const duplicate = await prisma.device.findFirst({
        where: { shopId: existing.shopId, imei: updateData.imei, deletedAt: null, id: { not: deviceId } },
        select: { id: true },
      })
      if (duplicate) return conflict('Bu IMEI bilan faol qurilma allaqachon mavjud')
    }

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
          // Native purchase-currency context, dual-written in lockstep with
          // the legacy UZS purchasePrice above — see docs/currency-accounting-model.md.
          ...(purchaseMeta
            ? {
                purchaseCurrency: purchaseMeta.inputCurrency,
                purchaseInputAmount: rawPurchasePriceInput,
                purchaseExchangeRateAtCreation: purchaseMeta.exchangeRateUsed,
                purchaseAmountUzsSnapshot: purchaseMeta.amountUzs,
              }
            : {}),
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
            purchasePrice: Number(existing.purchasePrice),
            imei: existing.imei,
            supplierPhone: existing.supplierPhone,
            note: existing.note,
          },
          newValue: {
            ...updateData,
            ...(purchaseMeta ? moneyInputMeta(purchaseMeta) : {}),
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
    // Backstop for the active-IMEI partial unique index if two edits race.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return conflict('Bu IMEI bilan faol qurilma allaqachon mavjud')
    }
    logger.error('[PATCH /api/devices/[id]]', { event: 'api.route_error', error: err })
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
    logger.error('[DELETE /api/devices/[id]]', { event: 'api.route_error', error: err })
    return serverError()
  }
}
