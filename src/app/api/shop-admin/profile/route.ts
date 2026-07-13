import { NextRequest } from 'next/server'
import bcrypt from 'bcrypt'
import { z, ZodError } from 'zod'
import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { badRequest, conflict, forbidden, notFound, ok, payloadTooLarge, serverError } from '@/lib/api-helpers'
import { requireApiSession } from '@/lib/api-auth'
import { isTelegramIdTaken, nextTelegramVerifiedAt, normalizeTelegramId } from '@/lib/telegram-id'
import { logger } from '@/lib/logger'
import { currentPasswordSchema, passwordSchema, phoneSchema } from '@/lib/validations'
import {
  isInvalidRequestBody,
  isRequestBodyTooLarge,
  readLimitedJsonBody,
} from '@/lib/server/request-limits'

const changePasswordSchema = z.object({
  currentPassword: currentPasswordSchema,
  newPassword: passwordSchema,
})

const updateTelegramSchema = z.object({
  telegramId: z
    .string()
    .trim()
    .regex(/^\d{5,20}$/, "Telegram ID faqat raqamlardan iborat bo'lishi kerak")
    .optional()
    .or(z.literal('')),
})

const updateProfileSchema = z.object({
  name: z.string().trim().min(2, "Ism kamida 2 ta harfdan iborat bo'lishi kerak").optional(),
  phone: phoneSchema.optional(),
})

function profileSelect() {
  return {
    id: true,
    name: true,
    phone: true,
    login: true,
    telegramId: true,
    telegramVerifiedAt: true,
    passwordChangedAt: true,
    shop: {
      select: {
        id: true,
        name: true,
        shopNumber: true,
      },
    },
  } satisfies Prisma.ShopAdminSelect
}

export async function GET() {
  try {
    const guarded = await requireApiSession()
    if (!guarded.ok) return guarded.response
    const { session } = guarded

    if (session.user.role !== 'SHOP_ADMIN' || !session.user.shopId) {
      return forbidden("Faqat do'kon adminlari uchun")
    }

    const admin = await prisma.shopAdmin.findFirst({
      where: {
        id: session.user.id,
        shopId: session.user.shopId,
        isActive: true,
        deletedAt: null,
      },
      select: profileSelect(),
    })

    if (!admin) return notFound("Admin topilmadi")

    return ok(admin)
  } catch (err) {
    logger.error('[GET /api/shop-admin/profile]', { event: 'api.route_error', error: err })
    return serverError()
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const guarded = await requireApiSession()
    if (!guarded.ok) return guarded.response
    const { session } = guarded

    if (session.user.role !== 'SHOP_ADMIN' || !session.user.shopId) {
      return forbidden("Faqat do'kon adminlari uchun")
    }

    const body = await readLimitedJsonBody(req)
    if (typeof body === 'object' && body !== null && 'telegramId' in body) {
      const parsed = updateTelegramSchema.safeParse(body)

      if (!parsed.success) {
        const firstError = (parsed.error as ZodError).issues[0]?.message ?? "Noto'g'ri ma'lumot"
        return badRequest(firstError)
      }

      const telegramId = normalizeTelegramId(parsed.data.telegramId)
      const admin = await prisma.shopAdmin.findFirst({
        where: {
          id: session.user.id,
          shopId: session.user.shopId,
          isActive: true,
          deletedAt: null,
        },
        select: {
          id: true,
          shopId: true,
          login: true,
          name: true,
          telegramId: true,
          telegramVerifiedAt: true,
        },
      })

      if (!admin) return notFound("Admin topilmadi")
      if (telegramId && (await isTelegramIdTaken(telegramId, { type: 'SHOP_ADMIN', id: admin.id }))) {
        return conflict(`Bu Telegram ID allaqachon tizimda bor: ${telegramId}`)
      }

      const updated = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.shopAdmin.update({
          where: { id: admin.id },
          data: {
            telegramId,
            telegramVerifiedAt: nextTelegramVerifiedAt(admin.telegramId, admin.telegramVerifiedAt, telegramId),
          },
        })

        await tx.log.create({
          data: {
            shopId: admin.shopId,
            actorId: admin.id,
            actorType: 'SHOP_ADMIN',
            action: 'UPDATE_TELEGRAM_ID',
            targetType: 'ShopAdmin',
            targetId: admin.id,
            oldValue: { telegramId: admin.telegramId, login: admin.login, name: admin.name },
            newValue: { telegramId },
          },
        })

        return tx.shopAdmin.findUniqueOrThrow({
          where: { id: admin.id },
          select: profileSelect(),
        })
      })

      return ok(updated, telegramId ? 'Telegram ID yangilandi.' : "Telegram ID o'chirildi.")
    }

    if (typeof body === 'object' && body !== null && ('name' in body || 'phone' in body)) {
      const parsed = updateProfileSchema.safeParse(body)
      if (!parsed.success) {
        const firstError = (parsed.error as ZodError).issues[0]?.message ?? "Noto'g'ri ma'lumot"
        return badRequest(firstError)
      }
      if (parsed.data.name === undefined && parsed.data.phone === undefined) {
        return badRequest("O'zgartirish uchun ma'lumot kiritilmadi")
      }

      const admin = await prisma.shopAdmin.findFirst({
        where: {
          id: session.user.id,
          shopId: session.user.shopId,
          isActive: true,
          deletedAt: null,
        },
        select: { id: true, shopId: true, name: true, phone: true, login: true },
      })
      if (!admin) return notFound('Admin topilmadi')

      const profileUpdate = {
        ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
        ...(parsed.data.phone !== undefined ? { phone: parsed.data.phone } : {}),
      }

      const updated = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.shopAdmin.update({ where: { id: admin.id }, data: profileUpdate })
        await tx.log.create({
          data: {
            shopId: admin.shopId,
            actorId: admin.id,
            actorType: 'SHOP_ADMIN',
            action: 'UPDATE',
            targetType: 'ShopAdmin',
            targetId: admin.id,
            oldValue: { name: admin.name, phone: admin.phone, login: admin.login },
            newValue: profileUpdate,
          },
        })
        return tx.shopAdmin.findUniqueOrThrow({ where: { id: admin.id }, select: profileSelect() })
      })

      return ok(updated, 'Profil yangilandi.')
    }

    const parsed = changePasswordSchema.safeParse(body)

    if (!parsed.success) {
      const firstError = (parsed.error as ZodError).issues[0]?.message ?? "Noto'g'ri ma'lumot"
      return badRequest(firstError)
    }

    const admin = await prisma.shopAdmin.findFirst({
      where: {
        id: session.user.id,
        shopId: session.user.shopId,
        isActive: true,
        deletedAt: null,
      },
      select: {
        id: true,
        shopId: true,
        login: true,
        name: true,
        passwordHash: true,
      },
    })

    if (!admin) return notFound("Admin topilmadi")

    const currentPasswordMatches = await bcrypt.compare(parsed.data.currentPassword, admin.passwordHash)
    if (!currentPasswordMatches) {
      return badRequest("Joriy parol noto'g'ri")
    }

    const newPasswordMatchesCurrent = await bcrypt.compare(parsed.data.newPassword, admin.passwordHash)
    if (newPasswordMatchesCurrent) {
      return badRequest('Yangi parol joriy paroldan farq qilishi kerak')
    }

    const passwordHash = await bcrypt.hash(parsed.data.newPassword, 12)

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.shopAdmin.update({
        where: { id: admin.id },
        data: {
          passwordHash,
          passwordChangedAt: new Date(),
          sessionVersion: { increment: 1 },
        },
      })
      await tx.authSession.updateMany({
        where: { actorType: 'SHOP_ADMIN', actorId: admin.id, revokedAt: null },
        data: { revokedAt: new Date() },
      })

      await tx.log.create({
        data: {
          shopId: admin.shopId,
          actorId: admin.id,
          actorType: 'SHOP_ADMIN',
          action: 'CHANGE_PASSWORD',
          targetType: 'ShopAdmin',
          targetId: admin.id,
          oldValue: { login: admin.login, name: admin.name },
          newValue: { passwordChanged: true },
        },
      })
    })

    return ok({ passwordChanged: true }, 'Parol yangilandi. Qayta kiring.')
  } catch (err) {
    if (isRequestBodyTooLarge(err)) return payloadTooLarge()
    if (isInvalidRequestBody(err)) return badRequest("So'rov ma'lumoti noto'g'ri")
    logger.error('[PATCH /api/shop-admin/profile]', { event: 'api.route_error', error: err })
    return serverError()
  }
}
