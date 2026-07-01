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

    const status = searchParams.get('status') ?? undefined
    const search = searchParams.get('search') ?? undefined // IMEI / model / color

    const devices = await prisma.device.findMany({
      where: {
        shopId,
        deletedAt: null,
        ...(status ? { status: status as 'IN_STOCK' | 'SOLD_CASH' | 'SOLD_NASIYA' | 'RESERVED' | 'RETURNED' | 'DELETED' } : {}),
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
    console.error('[POST /api/devices]', err)
    return serverError()
  }
}
