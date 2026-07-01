/**
 * GET  /api/devices — list devices for the authenticated shop
 * POST /api/devices — add a new device to the shop
 *
 * Both routes require SHOP_ADMIN (or SUPER_ADMIN) authentication.
 * Shop admins can only see/add devices for their own shop.
 */

import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireApiSession, resolveActiveShopId } from '@/lib/api-auth'
import { addDeviceSchema } from '@/lib/validations'
import { ok, created, badRequest, conflict, serverError } from '@/lib/api-helpers'
import { notifyShopAdmins } from '@/lib/notification-service'
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
      include: { supplier: true },
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

    // Check IMEI uniqueness within shop
    const existing = await prisma.device.findUnique({
      where: { shopId_imei: { shopId: resolvedShopId, imei } },
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
          purchasePrice,
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
          newValue: { model, imei, purchasePrice },
        },
      })

      return createdDevice
    })

    await notifyShopAdmins(
      resolvedShopId,
      `Yangi qurilma qo'shildi\nModel: ${model}\nIMEI: ${imei}\nKelish narxi: ${Number(purchasePrice).toLocaleString('ru-RU')} so'm`,
      'DEVICE_CREATED',
      device.id,
      'Device',
    )

    return created(device, "Qurilma muvaffaqiyatli qo'shildi")
  } catch (err) {
    // Handle the race where two concurrent adds both pass the IMEI pre-check
    // and one violates the @@unique([shopId, imei]) constraint (Prisma P2002).
    if (err && typeof err === 'object' && 'code' in err && (err as { code?: string }).code === 'P2002') {
      return conflict("Bu IMEI raqami allaqachon mavjud")
    }
    console.error('[POST /api/devices]', err)
    return serverError()
  }
}
