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
import { processPendingNotifications } from '@/lib/notification-service'
import { deviceAddedMessage } from '@/lib/telegram-templates'
import { logger } from '@/lib/logger'
import { invalidateShopDeviceMutation } from '@/lib/server/cache-tags'
import { moneyInputToUzs, moneyInputMeta } from '@/lib/server/money-input'
import { getShopCurrencyContext } from '@/lib/server/currency'
import { getShopDeviceListItemsByIds, getShopDevicesList, type DeviceStatusFilter } from '@/lib/server/shop-lists'
import { latestChangeCursorForShop } from '@/lib/server/change-events'
import type { ZodError } from 'zod'
import { formatDeviceStorage, deviceConditionLabel, normalizeImei } from '@/lib/device-specs'

const deviceStatuses = ['IN_STOCK', 'SOLD_CASH', 'SOLD_DEBT', 'SOLD_NASIYA', 'RETURNED', 'DELETED'] as const

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
    const conditionParam = searchParams.get('condition') ?? undefined
    if (conditionParam && conditionParam !== 'NEW' && conditionParam !== 'USED') return badRequest("Qurilma holati noto'g'ri")
    const search = searchParams.get('search') ?? undefined // IMEI / model / color / note / customer name/phone

    // Sale and nasiya forms need only a tiny searchable stock projection.
    // Keeping this separate from the full device-list projection avoids joins
    // to sales, nasiyas, returns and suppliers for every keystroke.
    if (searchParams.get('view') === 'picker') {
      const requestedTake = Number(searchParams.get('take') ?? 25)
      const requestedSkip = Number(searchParams.get('skip') ?? 0)
      const take = Number.isFinite(requestedTake) ? Math.trunc(Math.min(Math.max(requestedTake, 1), 50)) : 25
      const skip = Number.isFinite(requestedSkip) ? Math.trunc(Math.max(requestedSkip, 0)) : 0
      const pickerWhere = {
        shopId,
        deletedAt: null,
        status: 'IN_STOCK' as const,
        ...(search
          ? {
              OR: [
                { imei: { contains: search, mode: 'insensitive' as const } },
                { imeis: { some: { deletedAt: null, value: { contains: search, mode: 'insensitive' as const } } } },
                { model: { contains: search, mode: 'insensitive' as const } },
                { color: { contains: search, mode: 'insensitive' as const } },
                { storage: { contains: search, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      }

      const [rows, total] = await Promise.all([
        prisma.device.findMany({
          where: pickerWhere,
          orderBy: { createdAt: 'desc' },
          skip,
          take,
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
        }),
        prisma.device.count({ where: pickerWhere }),
      ])

      return ok(
        {
          items: rows.map((device) => ({
            ...device,
            purchasePrice: Number(device.purchasePrice),
            storageDisplay: formatDeviceStorage(device) || null,
            secondaryImei: device.imeis.find((entry) => entry.slot === 'SECONDARY')?.value ?? null,
            conditionLabel: deviceConditionLabel(device.conditionCode),
          })),
          total,
          skip,
          take,
        },
        "Qurilmalar ro'yxati",
      )
    }

    // The canonical response is always a bounded page envelope. `paginated=1`
    // remains harmless for older links, but no consumer can accidentally fall
    // back to the former wide, reduced-field array response.
    const requestedTake = Number(searchParams.get('take') ?? 25)
    const requestedSkip = Number(searchParams.get('skip') ?? 0)
    const take = Number.isFinite(requestedTake) ? Math.trunc(Math.min(Math.max(requestedTake, 1), 100)) : 25
    const skip = Number.isFinite(requestedSkip) ? Math.trunc(Math.max(requestedSkip, 0)) : 0
    const { items, total } = await getShopDevicesList(shopId, {
      search,
      status: status as DeviceStatusFilter | undefined,
      condition: conditionParam as 'NEW' | 'USED' | undefined,
      skip,
      take,
    })
    return ok({ items, total, skip, take }, "Qurilmalar ro'yxati")
  } catch (err) {
    logger.error('[GET /api/devices]', { event: 'api.route_error', error: err })
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
      model, color, storageAmount, storageUnit, conditionCode, batteryHealth, purchasePrice,
      supplierName, supplierPhone, note, imageUrls,
    } = parsed.data
    const storage = formatDeviceStorage({ storageAmount, storageUnit })
    const imei = normalizeImei(parsed.data.imei)!
    const secondaryImei = parsed.data.secondaryImei ? normalizeImei(parsed.data.secondaryImei) : null

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
    const [shop, currency] = await Promise.all([
      prisma.shop.findUnique({ where: { id: resolvedShopId }, select: { name: true } }),
      getShopCurrencyContext(resolvedShopId),
    ])
    const notificationMessage = deviceAddedMessage({
      shopName: shop?.name ?? '',
      device: { deviceModel: model, storage, color, batteryHealth, imei, secondaryImei, conditionLabel: conditionCode === 'NEW' ? 'Yangi' : 'B/U' },
      purchasePrice,
      purchaseCurrency: purchaseInput.inputCurrency,
      supplierPhone,
      adminName: session.user.name,
      currency,
    })

    // Check active IMEI uniqueness within shop. Soft-deleted rows may be reused.
    const existing = await prisma.device.findFirst({
      where: {
        shopId: resolvedShopId,
        deletedAt: null,
        OR: [
          { imei: { in: [imei, secondaryImei].filter((value): value is string => Boolean(value)) } },
          { imeis: { some: { normalizedValue: { in: [imei, secondaryImei].filter((value): value is string => Boolean(value)) }, deletedAt: null } } },
        ],
      },
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
          model, color, storage, storageAmount, storageUnit, conditionCode, condition: conditionCode === 'NEW' ? 'Yangi' : 'B/U', batteryHealth,
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
          imeis: {
            create: [
              { slot: 'PRIMARY', value: imei, normalizedValue: imei },
              ...(secondaryImei ? [{ slot: 'SECONDARY' as const, value: secondaryImei, normalizedValue: secondaryImei }] : []),
            ],
          },
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

      const notificationAdmins = await tx.shopAdmin.findMany({
        where: { shopId: resolvedShopId, isActive: true, telegramId: { not: null }, telegramVerifiedAt: { not: null }, deletedAt: null },
        select: { telegramId: true },
      })
      if (notificationAdmins.length) {
        await tx.notification.createMany({
          data: notificationAdmins.flatMap((admin) => admin.telegramId ? [{
            shopId: resolvedShopId,
            type: 'DEVICE_CREATED',
            message: notificationMessage,
            telegramId: admin.telegramId,
            status: 'PENDING' as const,
            scheduledAt: new Date(),
            relatedId: createdDevice.id,
            relatedType: 'Device',
          }] : []),
        })
      }

      return createdDevice
    })

    invalidateShopDeviceMutation(resolvedShopId)

    // Deliver notifications after the response is sent (non-blocking) so the
    // add-device request never waits on Telegram HTTP calls.
    after(async () => {
      try {
        await processPendingNotifications()
      } catch (e) {
        logger.warn('device create notification failed', {
          event: 'notification.flush_failed',
          route: '/api/devices',
          error: e,
        })
      }
    })

    const [item, changeCursor] = await Promise.all([
      getShopDeviceListItemsByIds(resolvedShopId, [device.id]).then((items) => items[0]),
      latestChangeCursorForShop(resolvedShopId),
    ])
    if (!item) throw new Error('CREATED_DEVICE_DTO_NOT_FOUND')
    return created({
      id: device.id,
      item,
      changeCursor,
      affectedDomains: ['devices', 'reports', 'logs'],
      mutationId: `device.created:${device.id}:${changeCursor}`,
    }, "Qurilma muvaffaqiyatli qo'shildi")
  } catch (err) {
    // Handle the race where two concurrent adds both pass the IMEI pre-check
    // and one violates the active partial unique index (Prisma P2002).
    if (err && typeof err === 'object' && 'code' in err && (err as { code?: string }).code === 'P2002') {
      return conflict("Bu IMEI raqami allaqachon mavjud")
    }
    logger.error('[POST /api/devices]', { event: 'api.route_error', error: err })
    return serverError()
  }
}
