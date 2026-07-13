/**
 * GET /api/shops  — list all shops (super admin only)
 * POST /api/shops — create a new shop with admins (super admin only)
 */

import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/generated/prisma/client'
import bcrypt from 'bcrypt'
import { createShopSchema } from '@/lib/validations'
import { ok, created, badRequest, conflict, payloadTooLarge, serverError } from '@/lib/api-helpers'
import { requireSuperAdmin } from '@/lib/api-auth'
import { shopAdminPublicSelect } from '@/lib/api-selects'
import { isTelegramIdTaken, normalizeTelegramId } from '@/lib/telegram-id'
import type { ZodError } from 'zod'
import { logger } from '@/lib/logger'
import {
  isInvalidRequestBody,
  isRequestBodyTooLarge,
  readLimitedJsonBody,
} from '@/lib/server/request-limits'
import { SHOP_FEATURE_CODES } from '@/lib/access-control'
import { tashkentTodayInputValue } from '@/lib/timezone'
import { isRetryableTransactionError } from '@/lib/server/transaction-retry'
import { normalizePhone } from '@/lib/phone'

async function runSerializable<T>(operation: () => Promise<T>) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      if (!isRetryableTransactionError(error) || attempt === 2) throw error
    }
  }
  throw new Error('SERIALIZABLE_TRANSACTION_FAILED')
}

// ---------------------------------------------------------------------------
// GET /api/shops
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  try {
    const guarded = await requireSuperAdmin()
    if (!guarded.ok) return guarded.response
    const includeDeleted = req.nextUrl.searchParams.get('includeDeleted') === 'true'
    const search = req.nextUrl.searchParams.get('search')?.trim()
    if (search && search.length > 100) return badRequest('Qidiruv 100 ta belgidan oshmasligi kerak')
    const statusParam = req.nextUrl.searchParams.get('status')?.trim()
    if (statusParam && !['ACTIVE', 'SUSPENDED', 'DELETED'].includes(statusParam)) {
      return badRequest("Do'kon statusi noto'g'ri")
    }
    const status = statusParam as 'ACTIVE' | 'SUSPENDED' | 'DELETED' | undefined
    const searchDigits = search ? normalizePhone(search) : null
    const requestedTake = Number(req.nextUrl.searchParams.get('take') ?? 200)
    const requestedSkip = Number(req.nextUrl.searchParams.get('skip') ?? 0)
    const take = Number.isFinite(requestedTake) ? Math.trunc(Math.min(Math.max(requestedTake, 1), 500)) : 200
    const skip = Number.isFinite(requestedSkip) ? Math.trunc(Math.max(requestedSkip, 0)) : 0

    const shops = await prisma.shop.findMany({
      where: {
        ...(includeDeleted ? {} : { deletedAt: null }),
        ...(status ? { status } : {}),
        ...(search ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' as const } },
            { ownerName: { contains: search, mode: 'insensitive' as const } },
            { ownerPhone: { contains: search, mode: 'insensitive' as const } },
            ...(searchDigits ? [{ ownerPhone: { contains: searchDigits } }] : []),
            { shopNumber: { contains: search, mode: 'insensitive' as const } },
          ],
        } : {}),
      },
      include: {
        admins: {
          where: { deletedAt: null, isActive: true },
          select: shopAdminPublicSelect,
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
    logger.error('[GET /api/shops]', { event: 'api.route_error', error: err })
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

    const body = await readLimitedJsonBody(req)
    const parsed = createShopSchema.safeParse(body)

    if (!parsed.success) {
      const firstError = (parsed.error as ZodError).issues[0]?.message ?? "Noto'g'ri ma'lumot"
      return badRequest(firstError)
    }

    const { name, ownerName, ownerPhone, shopNumber, address, note, admins } = parsed.data
    const accessMode = parsed.data.accessMode ?? (admins.length > 1 ? 'OWNER_AND_STAFF' : 'OWNER_ONLY')
    const today = tashkentTodayInputValue()
    if (parsed.data.package && parsed.data.package.effectiveOn !== today) {
      return badRequest("Yangi do'konning birinchi paketi bugungi sana bilan boshlanishi kerak")
    }
    const packageDraft = parsed.data.package ?? {
      effectiveOn: today,
      basePrice: 0,
      currency: 'UZS' as const,
      discountAmount: 0,
      note: "Boshlang'ich paket narxi bosh admin tomonidan ko'rib chiqilishi kerak",
      features: SHOP_FEATURE_CODES.map((featureCode) => ({
        featureCode,
        enabled: featureCode === 'STAFF_ACCESS' ? accessMode === 'OWNER_AND_STAFF' : true,
        recurringPrice: 0,
      })),
    }
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

    // bcrypt is intentionally completed before the database transaction so a
    // CPU-heavy password hash never holds PostgreSQL locks open.
    const adminsWithPasswordHash = await Promise.all(normalizedAdmins.map(async (admin) => ({
      ...admin,
      passwordHash: await bcrypt.hash(admin.password, 12),
    })))

    const shop = await runSerializable(() => prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      for (const telegramId of [...telegramIds].sort()) {
        await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`telegram:${telegramId}`}))`)
      }
      if (telegramIds.length) {
        const [superAdminOwner, shopAdminOwner] = await Promise.all([
          tx.superAdmin.findFirst({ where: { telegramId: { in: telegramIds }, deletedAt: null }, select: { id: true } }),
          tx.shopAdmin.findFirst({ where: { telegramId: { in: telegramIds }, deletedAt: null }, select: { id: true } }),
        ])
        if (superAdminOwner || shopAdminOwner) {
          throw Object.assign(new Error('TELEGRAM_TAKEN'), { code: 'TELEGRAM_TAKEN' })
        }
      }
      const subscriptionDue = new Date()
      const newShop = await tx.shop.create({
        data: {
          name,
          ownerName,
          ownerPhone,
          shopNumber,
          address: address ?? '',
          note,
          createdById: session.user.id,
          subscriptionDue,
          billingAnchorDay: Number(today.slice(-2)),
        },
      })

      let ownerAdminId: string | null = null
      for (const [index, admin] of adminsWithPasswordHash.entries()) {
        const member = await tx.shopAdmin.create({
          data: {
            shopId: newShop.id,
            name: admin.name,
            phone: admin.phone,
            login: admin.login,
            telegramId: admin.telegramId,
            telegramVerifiedAt: null,
            passwordHash: admin.passwordHash,
            legacyFullAccess: false,
          },
          select: { id: true },
        })
        if (index === 0) ownerAdminId = member.id
      }

      if (!ownerAdminId) throw new Error('OWNER_ADMIN_REQUIRED')

      await tx.shop.update({
        where: { id: newShop.id },
        data: {
          ownerAdminId,
          ownershipStatus: 'RESOLVED',
          ownershipResolvedAt: new Date(),
          ownershipResolvedById: session.user.id,
        },
      })

      await tx.shopPackageVersion.create({
        data: {
          shopId: newShop.id,
          effectiveOn: new Date(`${packageDraft.effectiveOn}T00:00:00.000Z`),
          basePrice: packageDraft.basePrice,
          currency: packageDraft.currency,
          discountAmount: packageDraft.discountAmount,
          pricingNeedsReview: !parsed.data.package,
          note: packageDraft.note,
          createdById: session.user.id,
          features: {
            create: packageDraft.features.map((feature) => ({
              featureCode: feature.featureCode,
              enabled: feature.enabled,
              recurringPrice: feature.recurringPrice,
            })),
          },
        },
      })

      await tx.log.create({
        data: {
          actorId: session.user.id,
          actorType: 'SUPER_ADMIN',
          action: 'CREATE',
          targetType: 'Shop',
          targetId: newShop.id,
          newValue: { name, ownerName, ownerPhone, shopNumber, ownerAdminId, accessMode },
        },
      })

      return tx.shop.findUniqueOrThrow({ where: { id: newShop.id } })
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }))

    return created(shop, "Do'kon muvaffaqiyatli yaratildi")
  } catch (err) {
    if (isRequestBodyTooLarge(err)) return payloadTooLarge()
    if (isInvalidRequestBody(err)) return badRequest("So'rov ma'lumoti noto'g'ri")
    if (err && typeof err === 'object' && 'code' in err) {
      if (err.code === 'TELEGRAM_TAKEN') return conflict('Bu Telegram ID allaqachon mavjud')
      if (err.code === 'P2002') return conflict('Login yoki boshqa noyob ma\'lumot allaqachon mavjud')
    }
    logger.error('[POST /api/shops]', { event: 'api.route_error', error: err })
    return serverError()
  }
}
