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
import { requireShopAnyPermission, requireShopPermission } from '@/lib/api-auth'
import { ok, badRequest, conflict, forbidden, notFound, serverError } from '@/lib/api-helpers'
import { invalidateShopDeviceMutation } from '@/lib/server/cache-tags'
import { moneyInputToUzs, moneyInputMeta } from '@/lib/server/money-input'
import { Prisma } from '@/generated/prisma/client'
import type { ZodError } from 'zod'
import { logger } from '@/lib/logger'
import { phoneSchema } from '@/lib/validations'
import { deviceConditionLabel, formatDeviceStorage, normalizeImei, resolveImeiPairUpdate } from '@/lib/device-specs'
import { getShopDeviceListItemsByIds } from '@/lib/server/shop-lists'
import { latestChangeCursorForShop } from '@/lib/server/change-events'
import {
  createPrivateUploadReference,
  privateUploadPreviewUrl,
  resolvePrivateUploadReference,
} from '@/lib/server/private-upload-reference'

type RouteContext = { params: Promise<{ id: string }> }

const STAFF_HIDDEN_DEVICE_DETAIL_FIELDS = [
  'purchasePrice',
  'purchaseCurrency',
  'purchaseInputAmount',
  'purchaseExchangeRateAtCreation',
  'purchaseAmountUzsSnapshot',
  'returns',
] as const

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const updateDeviceSchema = z.object({
  model: z.string().min(1).optional(),
  color: z.string().optional(),
  storageAmount: z.number().positive().optional(),
  storageUnit: z.enum(['GB', 'TB']).optional(),
  conditionCode: z.enum(['NEW', 'USED']).optional(),
  batteryHealth: z.number().int().min(0).max(100).optional(),
  purchasePrice: z.number().positive("Kelish narxi 0 dan katta bo'lishi kerak").optional(),
  // Display/input currency of purchasePrice. UZS by default (back-compatible);
  // USD is converted to UZS server-side — UZS remains the stored value.
  inputCurrency: z.enum(['UZS', 'USD']).optional(),
  imei: z.string().trim().refine((value) => normalizeImei(value) !== null, 'IMEI 15 ta raqamdan iborat bo\'lishi kerak').optional(),
  secondaryImei: z.string().trim().refine((value) => !value || normalizeImei(value) !== null, 'Qo‘shimcha IMEI 15 ta raqamdan iborat bo‘lishi kerak').optional(),
  supplierPhone: phoneSchema.or(z.literal('')).optional(),
  imageUrls: z.array(z.string().trim().min(1).max(500)).max(10).optional(),
  note: z.string().optional(),
  reason: z.string().optional(),
}).refine((data) => (data.storageAmount === undefined) === (data.storageUnit === undefined), {
  message: 'Xotira hajmi va birligi birga kiritilishi kerak',
  path: ['storageUnit'],
})

const deleteDeviceSchema = z.object({
  deleteNote: z.string().min(5, "O'chirish sababi kamida 5 ta belgi bo'lishi kerak"),
})

// ---------------------------------------------------------------------------
// GET /api/devices/[id]
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest, ctx: RouteContext) {
  try {
    const pickerPurpose = req.nextUrl.searchParams.get('view') === 'picker'
      ? req.nextUrl.searchParams.get('purpose')
      : null
    const detailPurpose = req.nextUrl.searchParams.get('purpose')
    if (req.nextUrl.searchParams.get('view') === 'picker' && pickerPurpose !== 'sale' && pickerPurpose !== 'nasiya') {
      return badRequest("Qurilma tanlash maqsadi noto'g'ri")
    }
    if (detailPurpose && detailPurpose !== 'device' && detailPurpose !== 'sale') {
      return badRequest("Qurilma ma'lumoti maqsadi noto'g'ri")
    }
    const guarded = pickerPurpose
      ? await requireShopPermission(pickerPurpose === 'sale' ? 'SALE_CREATE' : 'NASIYA_CREATE')
      : detailPurpose === 'device'
        ? await requireShopAnyPermission(['DEVICE_CREATE', 'DEVICE_EDIT', 'DEVICE_DELETE', 'DEVICE_RESTOCK'])
        : detailPurpose === 'sale'
          ? await requireShopAnyPermission([
              'SALE_VIEW',
              'SALE_CREATE',
              'SALE_EDIT',
              'SALE_PAYMENT_RECEIVE',
              'SALE_REMINDER_MANAGE',
              'SALE_RETURN_REFUND',
              'OLIB_CREATE',
            ])
      : await requireShopPermission('INVENTORY_VIEW')
    if (!guarded.ok) return guarded.response
    const { session } = guarded
    const includeOwnerFinancials =
      session.user.role === 'SUPER_ADMIN' || guarded.principal?.memberKind === 'SHOP_OWNER'

    const { id: deviceId } = await ctx.params

    if (req.nextUrl.searchParams.get('view') === 'picker') {
      const pickerDevice = await prisma.device.findFirst({
        where: {
          id: deviceId,
          deletedAt: null,
          shop: { status: 'ACTIVE', deletedAt: null },
          ...(session.user.role === 'SHOP_ADMIN' ? { shopId: session.user.shopId ?? '' } : {}),
        },
        select: {
          id: true,
          model: true,
          color: true,
          storage: true,
          storageAmount: true,
          storageUnit: true,
          conditionCode: true,
          batteryHealth: true,
          purchasePrice: true,
          imei: true,
          imeis: { where: { deletedAt: null }, select: { slot: true, value: true } },
          status: true,
        },
      })

      if (!pickerDevice) return notFound("Qurilma topilmadi")
      return ok(
        {
          ...(() => {
            const { purchasePrice, ...safeDevice } = pickerDevice
            return {
              ...safeDevice,
              ...(includeOwnerFinancials ? { purchasePrice: Number(purchasePrice) } : {}),
            }
          })(),
          storageDisplay: formatDeviceStorage(pickerDevice) || null,
          secondaryImei: pickerDevice.imeis.find((entry) => entry.slot === 'SECONDARY')?.value ?? null,
          conditionLabel: deviceConditionLabel(pickerDevice.conditionCode),
        },
        "Qurilma ma'lumotlari",
      )
    }

    const device = await prisma.device.findFirst({
      where: {
        id: deviceId,
        deletedAt: null,
        shop: { status: 'ACTIVE', deletedAt: null },
        ...(session.user.role === 'SHOP_ADMIN' ? { shopId: session.user.shopId ?? '' } : {}),
      },
      include: {
        imeis: { where: { deletedAt: null }, orderBy: { slot: 'asc' } },
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
                  paymentBreakdown: true,
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
            refundInputAmount: true,
            refundInputCurrency: true,
            refundExchangeRateAtCreation: true,
            refundMethod: true,
            contractCurrency: true,
            contractReceiptsAtReturn: true,
            contractRefundAmount: true,
            contractRetainedAmount: true,
            contractCancelledDebt: true,
            revenueReversalAmountUzs: true,
            inventoryCostRecoveryUzs: true,
            note: true,
            createdAt: true,
          },
        },
        nasiya: {
          where: { deletedAt: null, status: { not: 'CANCELLED' } },
          select: {
            id: true,
            status: true,
            resolutionState: true,
            totalAmount: true,
            interestPercent: true,
            interestAmount: true,
            finalNasiyaAmount: true,
            remainingAmount: true,
            // Native contract-currency ledger — see docs/currency-accounting-model.md.
            // Item 15 fix: the device detail page's nasiya card used to read
            // only the legacy UZS fields above, so a USD-native nasiya's
            // price/remaining/interest showed stuck in so'm.
            contractCurrency: true,
            contractTotalAmount: true,
            contractInterestAmount: true,
            contractFinalAmount: true,
            contractRemainingAmount: true,
            contractExchangeRateAtCreation: true,
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

    const imageUrls = device.imageUrls.flatMap((value) => {
      const key = resolvePrivateUploadReference({
        value,
        shopId: device.shopId,
        kind: 'device',
        allowLegacyRawKey: true,
      })
      if (key) {
        const reference = createPrivateUploadReference({ key, shopId: device.shopId, kind: 'device' })
        return [privateUploadPreviewUrl('device', reference)]
      }
      // Preserve a genuinely external legacy image, but never echo a broken
      // private reference or raw tenant key back into browser state.
      if (!value.startsWith('shops/') && !value.includes('/api/uploads/device')) return [value]
      return []
    })

    // A worker may need the device, sale, and payment information required to
    // complete an authorized operation. The inventory cost basis, margin
    // inputs, and return-accounting ledger are owner-only and must not enter
    // the browser response (or its query/navigation caches).
    const deviceForViewer = includeOwnerFinancials
      ? device
      : (() => {
          const staffSafeDevice: Record<string, unknown> = { ...device }
          for (const field of STAFF_HIDDEN_DEVICE_DETAIL_FIELDS) delete staffSafeDevice[field]
          return staffSafeDevice
        })()

    const purposeScopedDevice: Record<string, unknown> = { ...deviceForViewer }
    if (detailPurpose === 'device') {
      delete purposeScopedDevice.sales
      delete purposeScopedDevice.nasiya
      delete purposeScopedDevice.supplier
      delete purposeScopedDevice.supplierPhone
    } else if (detailPurpose === 'sale') {
      delete purposeScopedDevice.nasiya
      delete purposeScopedDevice.supplier
      delete purposeScopedDevice.supplierPhone
    }

    return ok({ ...purposeScopedDevice, imageUrls }, "Qurilma ma'lumotlari")
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
    const guarded = await requireShopPermission('DEVICE_EDIT')
    if (!guarded.ok) return guarded.response
    const { session } = guarded
    const includeOwnerFinancials =
      session.user.role === 'SUPER_ADMIN' || guarded.principal?.memberKind === 'SHOP_OWNER'

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
      include: { imeis: { where: { deletedAt: null } } },
    })

    if (!existing) return notFound("Qurilma topilmadi")

    const resolvedImageUrls = parsed.data.imageUrls?.map((value) => {
      const privateKey = resolvePrivateUploadReference({
        value,
        shopId: existing.shopId,
        kind: 'device',
        allowLegacyRawKey: true,
      })
      if (privateKey) return privateKey
      return existing.imageUrls.includes(value) && !value.startsWith('shops/') ? value : null
    })
    if (resolvedImageUrls?.some((value) => !value)) {
      return badRequest("Qurilma rasmi boshqa do'konga tegishli yoki havola muddati tugagan")
    }

    const { reason, inputCurrency, secondaryImei: secondaryImeiInput, ...updateData } = parsed.data
    if (!includeOwnerFinancials && updateData.purchasePrice !== undefined) {
      return forbidden("Kelish narxini faqat do'kon egasi o'zgartira oladi")
    }
    if (resolvedImageUrls) updateData.imageUrls = resolvedImageUrls as string[]
    const identityChanged = updateData.imei !== undefined || secondaryImeiInput !== undefined
    const imeiUpdate = resolveImeiPairUpdate(
      {
        primary: existing.imeis.find((entry) => entry.slot === 'PRIMARY')?.value ?? existing.imei,
        secondary: existing.imeis.find((entry) => entry.slot === 'SECONDARY')?.value ?? null,
      },
      { primary: updateData.imei, secondary: secondaryImeiInput },
    )
    if (!imeiUpdate.ok) return badRequest(imeiUpdate.message)
    const { primaryImei, secondaryImei } = imeiUpdate
    if (updateData.imei !== undefined) updateData.imei = primaryImei
    if (updateData.storageAmount !== undefined && updateData.storageUnit !== undefined) {
      (updateData as typeof updateData & { storage?: string }).storage = formatDeviceStorage(updateData)
    }
    if (updateData.conditionCode) (updateData as typeof updateData & { condition?: string }).condition = updateData.conditionCode === 'NEW' ? 'Yangi' : 'B/U'
    const [saleCount, nasiyaCount] = await prisma.$transaction([
      prisma.sale.count({ where: { deviceId, deletedAt: null } }),
      prisma.nasiya.count({ where: { deviceId, deletedAt: null } }),
    ])
    const isFinanciallyLinked =
      ['SOLD_CASH', 'SOLD_DEBT', 'SOLD_NASIYA'].includes(existing.status) || saleCount > 0 || nasiyaCount > 0

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
    if (identityChanged) {
      const imeiValues = [primaryImei, secondaryImei].filter((value): value is string => Boolean(value))
      const duplicate = await prisma.device.findFirst({
        where: { shopId: existing.shopId, deletedAt: null, id: { not: deviceId }, OR: [{ imei: { in: imeiValues } }, { imeis: { some: { normalizedValue: { in: imeiValues }, deletedAt: null } } }] },
        select: { id: true },
      })
      if (duplicate) return conflict('Bu IMEI bilan faol qurilma allaqachon mavjud')
    }

    const auditNote = reason?.trim() || updateData.note?.trim()
    const { imageUrls: _privateImageKeys, ...auditedUpdateData } = updateData
    void _privateImageKeys
    const device = await prisma.$transaction(async (tx) => {
      const guardedUpdate = await tx.device.updateMany({
        where: {
          id: deviceId,
          shopId: existing.shopId,
          deletedAt: null,
          ...(purchaseMeta
            ? {
                status: 'IN_STOCK' as const,
                sales: { none: { deletedAt: null } },
                nasiya: { none: { deletedAt: null } },
              }
            : {}),
        },
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
      if (guardedUpdate.count !== 1) {
        throw { status: 409, message: "Qurilma sotilgan paytda kelish narxini o'zgartirib bo'lmaydi" }
      }
      const updatedDevice = await tx.device.findFirstOrThrow({ where: { id: deviceId, shopId: existing.shopId } })

      if (identityChanged) {
        const deletedAt = new Date()
        await tx.deviceImei.updateMany({ where: { deviceId, deletedAt: null }, data: { deletedAt } })
        await tx.deviceImei.createMany({ data: [
          { shopId: existing.shopId, deviceId, slot: 'PRIMARY', value: primaryImei, normalizedValue: primaryImei },
          ...(secondaryImei ? [{ shopId: existing.shopId, deviceId, slot: 'SECONDARY' as const, value: secondaryImei, normalizedValue: secondaryImei }] : []),
        ] })
      }

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
            imageCount: existing.imageUrls.length,
            supplierPhone: existing.supplierPhone,
            note: existing.note,
          },
          newValue: {
            ...auditedUpdateData,
            ...(parsed.data.imageUrls !== undefined ? { imageCount: parsed.data.imageUrls.length } : {}),
            ...(purchaseMeta ? moneyInputMeta(purchaseMeta) : {}),
            ...(auditNote ? { editNote: auditNote } : {}),
          },
          note: auditNote,
        },
      })

      return updatedDevice
    })

    invalidateShopDeviceMutation(existing.shopId)

    const [item, changeCursor] = await Promise.all([
      getShopDeviceListItemsByIds(existing.shopId, [device.id], { includeOwnerFinancials }).then((items) => items[0]),
      latestChangeCursorForShop(existing.shopId),
    ])
    if (!item) throw new Error('UPDATED_DEVICE_DTO_NOT_FOUND')
    return ok({ item, changeCursor, affectedDomains: ['devices', 'reports', 'logs'], mutationId: `device.updated:${device.id}:${changeCursor}` }, "Qurilma muvaffaqiyatli yangilandi")
  } catch (err) {
    if (typeof err === 'object' && err !== null && 'status' in err) {
      const structured = err as { status: number; message: string }
      if (structured.status === 409) return conflict(structured.message)
    }
    // Backstop for the active-IMEI partial unique index if two edits race.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return conflict('Bu IMEI allaqachon mavjud.')
    }
    if (err instanceof Error && err.message === 'UPDATED_DEVICE_DTO_NOT_FOUND') {
      return serverError('Qurilma yangilandi, ammo yangilangan ma’lumotni yuklab bo‘lmadi. Sahifani yangilang.')
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
    const guarded = await requireShopPermission('DEVICE_DELETE')
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
    if (['SOLD_CASH', 'SOLD_DEBT', 'SOLD_NASIYA'].includes(existing.status)) {
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
      const guardedDelete = await tx.device.updateMany({
        where: {
          id: deviceId,
          shopId: existing.shopId,
          deletedAt: null,
          status: 'IN_STOCK',
          sales: { none: { deletedAt: null } },
          nasiya: { none: { deletedAt: null } },
        },
        data: {
          deletedAt: new Date(),
          deletedBy: session.user.id,
          deleteNote,
          status: 'DELETED',
          updatedAt: new Date(),
        },
      })
      if (guardedDelete.count !== 1) {
        throw { status: 409, message: "Qurilma sotilgan yoki moliyaviy tarixga bog'langan; o'chirish bekor qilindi" }
      }
      const deletedDevice = await tx.device.findFirstOrThrow({ where: { id: deviceId, shopId: existing.shopId } })

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
    if (typeof err === 'object' && err !== null && 'status' in err) {
      const structured = err as { status: number; message: string }
      if (structured.status === 409) return conflict(structured.message)
    }
    logger.error('[DELETE /api/devices/[id]]', { event: 'api.route_error', error: err })
    return serverError()
  }
}
