/**
 * GET  /api/devices — list devices for the authenticated shop
 * POST /api/devices — add a new device to the shop
 *
 * Both routes require SHOP_ADMIN (or SUPER_ADMIN) authentication.
 * Shop admins can only see/add devices for their own shop.
 */

import { NextRequest, after } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireApiSession, resolveActiveShopId } from '@/lib/api-auth'
import { addDeviceSchema } from '@/lib/validations'
import { ok, created, badRequest, conflict, serverError } from '@/lib/api-helpers'
import { notifyShopAdmins } from '@/lib/notification-service'
import { deviceAddedMessage } from '@/lib/telegram-templates'
import { logger } from '@/lib/logger'
import { invalidateShopDeviceMutation } from '@/lib/server/cache-tags'
import { moneyInputToUzs, moneyInputMeta } from '@/lib/server/money-input'
import { getShopCurrencyContext } from '@/lib/server/currency'
import type { ZodError } from 'zod'

const deviceStatuses = ['IN_STOCK', 'SOLD_CASH', 'SOLD_NASIYA', 'RESERVED', 'RETURNED', 'DELETED'] as const

// ---------------------------------------------------------------------------
// GET /api/devices
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  try {
    const guarded = await requireApiSession()
    if (!guarded.ok) return guarded.response
    const { session } = guarded

    const { searchParams } = req.nextUrl

    // Super admins can pass an explicit shopId; shop admins are scoped to their own shop.
    const resolved = await resolveActiveShopId(session, searchParams.get('shopId'))
    if (!resolved.ok) return resolved.response
    const { shopId } = resolved

    const statusParam = searchParams.get('status') ?? undefined
    if (statusParam && !deviceStatuses.includes(statusParam as (typeof deviceStatuses)[number])) {
      return badRequest("Qurilma statusi noto'g'ri")
    }
    const status = statusParam as (typeof deviceStatuses)[number] | undefined
    const search = searchParams.get('search') ?? undefined // IMEI / model / color
    const requestedTake = Number(searchParams.get('take') ?? 200)
    const requestedSkip = Number(searchParams.get('skip') ?? 0)
    const take = Number.isFinite(requestedTake) ? Math.trunc(Math.min(Math.max(requestedTake, 1), 500)) : 200
    const skip = Number.isFinite(requestedSkip) ? Math.trunc(Math.max(requestedSkip, 0)) : 0

    const devices = await prisma.device.findMany({
      where: {
        shopId,
        deletedAt: null,
        ...(status ? { status } : {}),
        ...(search
          ? {
              OR: [
                { imei: { contains: search, mode: 'insensitive' } },
                { model: { contains: search, mode: 'insensitive' } },
                { color: { contains: search, mode: 'insensitive' } },
                { storage: { contains: search, mode: 'insensitive' } },
                { supplierPhone: { contains: search, mode: 'insensitive' } },
                { supplier: { phone: { contains: search, mode: 'insensitive' } } },
                { sales: { some: { customer: { phone: { contains: search, mode: 'insensitive' } } } } },
                { nasiya: { some: { customer: { phone: { contains: search, mode: 'insensitive' } } } } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take,
      skip,
      select: {
        id: true,
        model: true,
        color: true,
        storage: true,
        batteryHealth: true,
        purchasePrice: true,
        imei: true,
        status: true,
        imageUrls: true,
        createdAt: true,
      },
    })

    return ok(devices, "Qurilmalar ro'yxati")
  } catch (err) {
    console.error('[GET /api/devices]', err)
    return serverError()
  }
}

// ---------------------------------------------------------------------------
// POST /api/devices
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  try {
    const guarded = await requireApiSession()
    if (!guarded.ok) return guarded.response
    const { session } = guarded

    const body: unknown = await req.json()

    const parsed = addDeviceSchema.safeParse(body)

    if (!parsed.success) {
      const firstError = (parsed.error as ZodError).issues[0]?.message ?? "Noto'g'ri ma'lumot"
      return badRequest(firstError)
    }

    const {
      model, color, storage, batteryHealth, purchasePrice,
      supplierName, supplierPhone, note, imageUrls,
    } = parsed.data
    const imei = parsed.data.imei.trim()

    const resolved = await resolveActiveShopId(
      session,
      session.user.role === 'SUPER_ADMIN' ? (body as { shopId?: string }).shopId : session.user.shopId,
    )
    if (!resolved.ok) return resolved.response
    const resolvedShopId = resolved.shopId
    if (imageUrls?.some((url) => !url.startsWith(`shops/${resolvedShopId}/devices/`))) {
      return badRequest('Qurilma rasmi faqat shu do\'kon private storage papkasidan bo\'lishi kerak')
    }
    let purchaseInput: Awaited<ReturnType<typeof moneyInputToUzs>>
    try {
      purchaseInput = await moneyInputToUzs(purchasePrice, parsed.data.inputCurrency)
    } catch (err) {
      return badRequest(err instanceof Error ? err.message : 'Valyuta kursi mavjud emas')
    }

    // Check active IMEI uniqueness within shop. Soft-deleted rows may be reused.
    const existing = await prisma.device.findFirst({
      where: { shopId: resolvedShopId, imei, deletedAt: null },
    })
    if (existing) return conflict("Bu IMEI raqami allaqachon mavjud")

    const device = await prisma.$transaction(async (tx) => {
      let supplierId: string | undefined
      if (supplierName) {
        const supplier = await tx.supplier.create({
          data: { shopId: resolvedShopId, name: supplierName, phone: supplierPhone ?? '' },
        })
        supplierId = supplier.id
      }

      const createdDevice = await tx.device.create({
        data: {
          shopId: resolvedShopId,
          model, color, storage, batteryHealth,
          purchasePrice: purchaseInput.amountUzs,
          // Native purchase-currency context — see docs/currency-accounting-model.md.
          purchaseCurrency: purchaseInput.inputCurrency,
          purchaseInputAmount: purchasePrice,
          purchaseExchangeRateAtCreation: purchaseInput.exchangeRateUsed,
          purchaseAmountUzsSnapshot: purchaseInput.amountUzs,
          imei,
          supplierId,
          supplierPhone,
          imageUrls: imageUrls ?? [],
          addedBy: session.user.id,
          note,
        },
      })

      await tx.log.create({
        data: {
          shopId: resolvedShopId,
          actorId: session.user.id,
          actorType: session.user.role as 'SUPER_ADMIN' | 'SHOP_ADMIN',
          action: 'CREATE',
          targetType: 'Device',
          targetId: createdDevice.id,
          newValue: { model, imei, purchasePrice: purchaseInput.amountUzs, ...moneyInputMeta(purchaseInput) },
        },
      })

      return createdDevice
    })

    invalidateShopDeviceMutation(resolvedShopId)

    // Deliver notifications after the response is sent (non-blocking) so the
    // add-device request never waits on Telegram HTTP calls.
    after(async () => {
      try {
        const shop = await prisma.shop.findUnique({
          where: { id: resolvedShopId },
          select: { name: true },
        })
        const currency = await getShopCurrencyContext(resolvedShopId)
        await notifyShopAdmins(
          resolvedShopId,
          deviceAddedMessage({
            shopName: shop?.name ?? '',
            device: { deviceModel: model, storage, color, batteryHealth, imei },
            purchasePrice,
            purchaseCurrency: purchaseInput.inputCurrency,
            supplierPhone,
            adminName: session.user.name,
            currency,
          }),
          'DEVICE_CREATED',
          device.id,
          'Device',
        )
      } catch (e) {
        logger.warn('device create notification failed', {
          event: 'notification.flush_failed',
          route: '/api/devices',
          error: e,
        })
      }
    })

    return created(device, "Qurilma muvaffaqiyatli qo'shildi")
  } catch (err) {
    // Handle the race where two concurrent adds both pass the IMEI pre-check
    // and one violates the active partial unique index (Prisma P2002).
    if (err && typeof err === 'object' && 'code' in err && (err as { code?: string }).code === 'P2002') {
      return conflict("Bu IMEI raqami allaqachon mavjud")
    }
    console.error('[POST /api/devices]', err)
    return serverError()
  }
}
