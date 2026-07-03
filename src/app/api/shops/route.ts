/**
 * GET /api/shops  — list all shops (super admin only)
 * POST /api/shops — create a new shop with admins (super admin only)
 */

import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/generated/prisma/client'
import bcrypt from 'bcrypt'
import { createShopSchema } from '@/lib/validations'
import { ok, created, badRequest, conflict, serverError } from '@/lib/api-helpers'
import { requireSuperAdmin } from '@/lib/api-auth'
import { shopAdminPublicSelect } from '@/lib/api-selects'
import { isTelegramIdTaken, normalizeTelegramId } from '@/lib/telegram-id'
import type { ZodError } from 'zod'

// ---------------------------------------------------------------------------
// GET /api/shops
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  try {
    const guarded = await requireSuperAdmin()
    if (!guarded.ok) return guarded.response
    const includeDeleted = req.nextUrl.searchParams.get('includeDeleted') === 'true'
    const requestedTake = Number(req.nextUrl.searchParams.get('take') ?? 200)
    const requestedSkip = Number(req.nextUrl.searchParams.get('skip') ?? 0)
    const take = Number.isFinite(requestedTake) ? Math.trunc(Math.min(Math.max(requestedTake, 1), 500)) : 200
    const skip = Number.isFinite(requestedSkip) ? Math.trunc(Math.max(requestedSkip, 0)) : 0

    const shops = await prisma.shop.findMany({
      where: includeDeleted ? {} : { deletedAt: null },
      include: {
        admins: {
          where: { deletedAt: null, isActive: true },
          select: shopAdminPublicSelect,
        },
        payments: {
          where: { deletedAt: null },
          orderBy: { paidAt: 'desc' },
          take: 12,
          include: {
            recordedBy: { select: { name: true, login: true } },
          },
        },
        _count: {
          select: {
            devices: { where: { deletedAt: null } },
            nasiya: { where: { deletedAt: null, status: { not: 'CANCELLED' } } },
          },
        },
      },
      orderBy: { subscriptionDue: 'asc' },
      take,
      skip,
    })

    return ok(shops, "Do'konlar ro'yxati")
  } catch (err) {
    console.error('[GET /api/shops]', err)
    return serverError()
  }
}

// ---------------------------------------------------------------------------
// POST /api/shops
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  try {
    const guarded = await requireSuperAdmin()
    if (!guarded.ok) return guarded.response
    const { session } = guarded

    const body: unknown = await req.json()
    const parsed = createShopSchema.safeParse(body)

    if (!parsed.success) {
      const firstError = (parsed.error as ZodError).issues[0]?.message ?? "Noto'g'ri ma'lumot"
      return badRequest(firstError)
    }

    const { name, ownerName, ownerPhone, shopNumber, address, note, admins } = parsed.data
    const duplicateLogin = admins.find((admin, index) =>
      admins.some((other, otherIndex) => otherIndex !== index && other.login === admin.login),
    )
    if (duplicateLogin) {
      return conflict(`Admin login takrorlangan: ${duplicateLogin.login}`)
    }

    const existingLogin = await prisma.shopAdmin.findFirst({
      where: { login: { in: admins.map((admin) => admin.login) } },
      select: { login: true },
    })
    if (existingLogin) {
      return conflict(`Bu login allaqachon mavjud: ${existingLogin.login}`)
    }

    const normalizedAdmins = admins.map((admin) => ({
      ...admin,
      telegramId: normalizeTelegramId(admin.telegramId),
    }))
    const telegramIds = normalizedAdmins
      .map((admin) => admin.telegramId)
      .filter((telegramId): telegramId is string => telegramId !== null)
    const duplicateTelegramId = telegramIds.find((telegramId, index) => telegramIds.indexOf(telegramId) !== index)
    if (duplicateTelegramId) {
      return conflict(`Telegram ID takrorlangan: ${duplicateTelegramId}`)
    }
    for (const telegramId of telegramIds) {
      if (await isTelegramIdTaken(telegramId)) {
        return conflict(`Bu Telegram ID allaqachon tizimda bor: ${telegramId}`)
      }
    }

    const shop = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const newShop = await tx.shop.create({
        data: {
          name,
          ownerName,
          ownerPhone,
          shopNumber,
          address: address ?? '',
          note,
          createdById: session.user.id,
          subscriptionDue: new Date(),
        },
      })

      for (const admin of normalizedAdmins) {
        const passwordHash = await bcrypt.hash(admin.password, 12)
        await tx.shopAdmin.create({
          data: {
            shopId: newShop.id,
            name: admin.name,
            phone: admin.phone,
            login: admin.login,
            telegramId: admin.telegramId,
            telegramVerifiedAt: admin.telegramId ? new Date() : null,
            passwordHash,
          },
        })
      }

      await tx.log.create({
        data: {
          actorId: session.user.id,
          actorType: 'SUPER_ADMIN',
          action: 'CREATE',
          targetType: 'Shop',
          targetId: newShop.id,
          newValue: { name, ownerName, ownerPhone, shopNumber },
        },
      })

      return newShop
    })

    return created(shop, "Do'kon muvaffaqiyatli yaratildi")
  } catch (err) {
    console.error('[POST /api/shops]', err)
    return serverError()
  }
}
