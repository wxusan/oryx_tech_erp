/**
 * POST   /api/shops/[id]/admins — create the first owner for an unresolved shop (super admin only)
 * PATCH  /api/shops/[id]/admins — reset a shop admin password (super admin only)
 * DELETE /api/shops/[id]/admins — soft-delete a shop admin (super admin only)
 */

import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/generated/prisma/client'
import bcrypt from 'bcrypt'
import { ok, created, badRequest, conflict, notFound, payloadTooLarge, serverError } from '@/lib/api-helpers'
import { requireSuperAdmin } from '@/lib/api-auth'
import { shopAdminPublicSelect } from '@/lib/api-selects'
import { isTelegramIdTaken, normalizeTelegramId } from '@/lib/telegram-id'
import { z, ZodError } from 'zod'
import { logger } from '@/lib/logger'
import { passwordSchema, phoneSchema } from '@/lib/validations'
import {
  isInvalidRequestBody,
  isRequestBodyTooLarge,
  readLimitedJsonBody,
} from '@/lib/server/request-limits'
import { isRetryableTransactionError } from '@/lib/server/transaction-retry'

type RouteContext = { params: Promise<{ id: string }> }

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
// Schemas
// ---------------------------------------------------------------------------

const createOwnerSchema = z.object({
  name: z
    .string({ error: "Admin ismi kiritilishi shart" })
    .min(2, "Ism kamida 2 ta harfdan iborat bo'lishi kerak")
    .max(100, "Ism 100 ta belgidan oshmasligi kerak"),
  phone: phoneSchema,
  telegramId: z
    .string()
    .trim()
    .regex(/^\d{5,20}$/, "Telegram ID faqat raqamlardan iborat bo'lishi kerak")
    .optional()
    .or(z.literal('')),
  login: z
    .string({ error: "Login kiritilishi shart" })
    .min(3, "Login kamida 3 ta belgidan iborat bo'lishi kerak")
    .max(64, "Login 64 ta belgidan oshmasligi kerak")
    .regex(/^[a-zA-Z0-9_]+$/, "Login faqat lotin harflari, raqamlar va _ belgisidan iborat bo'lishi kerak"),
  password: passwordSchema,
})

const deleteAdminSchema = z.object({
  adminId: z.string({ error: "Admin ID kiritilishi shart" }).min(1).max(100),
  note: z
    .string({ error: "O'chirish sababi kiritilishi shart" })
    .min(5, "O'chirish sababi kamida 5 ta belgidan iborat bo'lishi kerak")
    .max(1000, "Sabab 1000 ta belgidan oshmasligi kerak"),
})

const resetPasswordSchema = z.object({
  adminId: z.string({ error: "Admin ID kiritilishi shart" }).min(1).max(100),
  password: passwordSchema,
  note: z
    .string({ error: "Sabab kiritilishi shart" })
    .min(5, "Sabab kamida 5 ta belgidan iborat bo'lishi kerak")
    .max(1000, "Sabab 1000 ta belgidan oshmasligi kerak"),
})

// ---------------------------------------------------------------------------
// POST /api/shops/[id]/admins
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const guarded = await requireSuperAdmin()
    if (!guarded.ok) return guarded.response
    const { session } = guarded

    const { id } = await ctx.params
    const body = await readLimitedJsonBody(req)
    const parsed = createOwnerSchema.safeParse(body)

    if (!parsed.success) {
      const firstError = (parsed.error as ZodError).issues[0]?.message ?? "Noto'g'ri ma'lumot"
      return badRequest(firstError)
    }

    const shop = await prisma.shop.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, ownerAdminId: true, ownershipStatus: true },
    })
    if (!shop) return notFound("Do'kon topilmadi")
    if (shop.ownerAdminId || shop.ownershipStatus === 'RESOLVED') {
      return conflict("Do'konda ega bor. Xodimlarni faqat do'kon egasi yaratadi")
    }

    const existingLogin = await prisma.shopAdmin.findFirst({
      where: { login: parsed.data.login },
      select: { id: true, deletedAt: true },
    })
    if (existingLogin) {
      return conflict(
        existingLogin.deletedAt
          ? "Bu login oldin ishlatilgan. Iltimos, boshqa login tanlang"
          : 'Bu login allaqachon mavjud',
      )
    }

    const telegramId = normalizeTelegramId(parsed.data.telegramId)
    if (telegramId && (await isTelegramIdTaken(telegramId))) {
      return conflict(`Bu Telegram ID allaqachon tizimda bor: ${telegramId}`)
    }

    const passwordHash = await bcrypt.hash(parsed.data.password, 12)

    const admin = await runSerializable(() => prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const lockedShops = await tx.$queryRaw<Array<{ id: string; ownerAdminId: string | null; ownershipStatus: string }>>(
        Prisma.sql`SELECT "id", "ownerAdminId", "ownershipStatus" FROM "Shop" WHERE "id" = ${id} AND "deletedAt" IS NULL FOR UPDATE`,
      )
      const lockedShop = lockedShops[0]
      if (!lockedShop) throw Object.assign(new Error('SHOP_NOT_FOUND'), { code: 'SHOP_NOT_FOUND' })
      if (lockedShop.ownerAdminId || lockedShop.ownershipStatus === 'RESOLVED') {
        throw Object.assign(new Error('OWNER_ALREADY_RESOLVED'), { code: 'OWNER_ALREADY_RESOLVED' })
      }
      if (telegramId) {
        await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`telegram:${telegramId}`}))`)
        const [superAdminOwner, shopAdminOwner] = await Promise.all([
          tx.superAdmin.findFirst({ where: { telegramId, deletedAt: null }, select: { id: true } }),
          tx.shopAdmin.findFirst({ where: { telegramId, deletedAt: null }, select: { id: true } }),
        ])
        if (superAdminOwner || shopAdminOwner) {
          throw Object.assign(new Error('TELEGRAM_TAKEN'), { code: 'TELEGRAM_TAKEN' })
        }
      }
      const newAdmin = await tx.shopAdmin.create({
        data: {
          shopId: id,
          name: parsed.data.name,
          phone: parsed.data.phone,
          login: parsed.data.login,
          telegramId,
          telegramVerifiedAt: null,
          passwordHash,
        },
      })

      await tx.shop.update({
        where: { id },
        data: {
          ownerAdminId: newAdmin.id,
          ownershipStatus: 'RESOLVED',
          ownershipResolvedAt: new Date(),
          ownershipResolvedById: session.user.id,
          authorizationVersion: { increment: 1 },
        },
      })

      await tx.log.create({
        data: {
          shopId: id,
          actorId: session.user.id,
          actorType: 'SUPER_ADMIN',
          action: 'OWNER_CREATE',
          targetType: 'ShopAdmin',
          targetId: newAdmin.id,
          newValue: { name: parsed.data.name, phone: parsed.data.phone, login: parsed.data.login },
        },
      })

      return tx.shopAdmin.findUniqueOrThrow({
        where: { id: newAdmin.id },
        select: shopAdminPublicSelect,
      })
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }))

    return created(admin, "Do'kon egasi muvaffaqiyatli yaratildi")
  } catch (err) {
    if (isRequestBodyTooLarge(err)) return payloadTooLarge()
    if (isInvalidRequestBody(err)) return badRequest("So'rov ma'lumoti noto'g'ri")
    if (err && typeof err === 'object' && 'code' in err && err.code === 'SHOP_NOT_FOUND') {
      return notFound('Do‘kon topilmadi.')
    }
    if (err && typeof err === 'object' && 'code' in err && err.code === 'OWNER_ALREADY_RESOLVED') {
      return conflict('Do‘kon egasi allaqachon biriktirilgan.')
    }
    if (err && typeof err === 'object' && 'code' in err && err.code === 'TELEGRAM_TAKEN') {
      return conflict('Bu Telegram hisobi boshqa foydalanuvchiga biriktirilgan.')
    }
    if (err instanceof Error && err.message === 'SERIALIZABLE_TRANSACTION_FAILED') return serverError('Amalni yakunlab bo‘lmadi. Iltimos, qayta urinib ko‘ring.')
    logger.error('[POST /api/shops/[id]/admins]', { event: 'api.route_error', error: err })
    return serverError()
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/shops/[id]/admins
// ---------------------------------------------------------------------------

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  try {
    const guarded = await requireSuperAdmin()
    if (!guarded.ok) return guarded.response
    const { session } = guarded

    const { id } = await ctx.params
    const body = await readLimitedJsonBody(req)
    const parsed = resetPasswordSchema.safeParse(body)

    if (!parsed.success) {
      const firstError = (parsed.error as ZodError).issues[0]?.message ?? "Noto'g'ri ma'lumot"
      return badRequest(firstError)
    }

    const { adminId, password, note } = parsed.data
    const existing = await prisma.shopAdmin.findFirst({
      where: { id: adminId, shopId: id, deletedAt: null },
      select: { id: true, login: true, name: true },
    })
    if (!existing) return notFound("Admin topilmadi")

    const passwordHash = await bcrypt.hash(password, 12)
    const updated = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
	      await tx.shopAdmin.update({
	        where: { id: adminId },
	        data: {
	          passwordHash,
	          passwordChangedAt: new Date(),
	          sessionVersion: { increment: 1 },
	        },
	      })
      await tx.authSession.updateMany({
        where: { actorType: 'SHOP_ADMIN', actorId: adminId, revokedAt: null },
        data: { revokedAt: new Date() },
      })

      await tx.log.create({
        data: {
          shopId: id,
          actorId: session.user.id,
          actorType: 'SUPER_ADMIN',
          action: 'RESET_PASSWORD',
          targetType: 'ShopAdmin',
          targetId: adminId,
          oldValue: { login: existing.login, name: existing.name },
          newValue: { passwordReset: true },
          note,
        },
      })

      return tx.shopAdmin.findUniqueOrThrow({
        where: { id: adminId },
        select: shopAdminPublicSelect,
      })
    })

    return ok(updated, "Admin paroli muvaffaqiyatli yangilandi")
  } catch (err) {
    if (isRequestBodyTooLarge(err)) return payloadTooLarge()
    if (isInvalidRequestBody(err)) return badRequest("So'rov ma'lumoti noto'g'ri")
    logger.error('[PATCH /api/shops/[id]/admins]', { event: 'api.route_error', error: err })
    return serverError()
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/shops/[id]/admins
// ---------------------------------------------------------------------------

export async function DELETE(req: NextRequest, ctx: RouteContext) {
  try {
    const guarded = await requireSuperAdmin()
    if (!guarded.ok) return guarded.response
    const { session } = guarded

    const { id } = await ctx.params
    const body = await readLimitedJsonBody(req)
    const parsed = deleteAdminSchema.safeParse(body)

    if (!parsed.success) {
      const firstError = (parsed.error as ZodError).issues[0]?.message ?? "O'chirish sababi kiritilishi shart"
      return badRequest(firstError)
    }

    const { adminId, note } = parsed.data

    const existing = await prisma.shopAdmin.findFirst({
      where: { id: adminId, shopId: id, deletedAt: null },
    })
    if (!existing) return notFound("Admin topilmadi")
    const shop = await prisma.shop.findUnique({ where: { id }, select: { ownerAdminId: true } })
    if (shop?.ownerAdminId === adminId) {
      return conflict("Do'kon egasini o'chirib bo'lmaydi. Avval egalikni boshqa profilga o'tkazing")
    }

    const deleted = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.shopAdmin.update({
        where: { id: adminId },
        data: {
	          isActive: false,
	          deletedAt: new Date(),
	          deletedBy: session.user.id,
	          sessionVersion: { increment: 1 },
	        },
      })
      await tx.authSession.updateMany({
        where: { actorType: 'SHOP_ADMIN', actorId: adminId, revokedAt: null },
        data: { revokedAt: new Date() },
      })

      await tx.log.create({
        data: {
          shopId: id,
          actorId: session.user.id,
          actorType: 'SUPER_ADMIN',
          action: 'DELETE',
          targetType: 'ShopAdmin',
          targetId: adminId,
          note,
        },
      })

      return tx.shopAdmin.findUniqueOrThrow({
        where: { id: adminId },
        select: shopAdminPublicSelect,
      })
    })

    return ok(deleted, "Admin muvaffaqiyatli o'chirildi")
  } catch (err) {
    if (isRequestBodyTooLarge(err)) return payloadTooLarge()
    if (isInvalidRequestBody(err)) return badRequest("So'rov ma'lumoti noto'g'ri")
    logger.error('[DELETE /api/shops/[id]/admins]', { event: 'api.route_error', error: err })
    return serverError()
  }
}
