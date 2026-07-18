import { NextRequest } from 'next/server'
import bcrypt from 'bcrypt'
import { z, ZodError } from 'zod'
import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { badRequest, conflict, forbidden, notFound, ok, payloadTooLarge, serverError } from '@/lib/api-helpers'
import { requireApiSession } from '@/lib/api-auth'
import { normalizeTelegramId } from '@/lib/telegram-id'
import { logger } from '@/lib/logger'
import { currentPasswordSchema, passwordSchema, phoneSchema } from '@/lib/validations'
import {
  isInvalidRequestBody,
  isRequestBodyTooLarge,
  readLimitedJsonBody,
} from '@/lib/server/request-limits'
import {
  processDueTelegramDisableTransitions,
  linkShopAdminTelegramIdentityInTransaction,
  reconcileLinkedTelegramIdentity,
  unlinkShopAdminTelegramIdentityInTransaction,
} from '@/lib/server/telegram-lifecycle'

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
    telegramNotificationsEnabled: true,
    passwordChangedAt: true,
    shop: {
      select: {
        id: true,
        name: true,
        shopNumber: true,
        telegramNotificationsEnabled: true,
      },
    },
  } satisfies Prisma.ShopAdminSelect
}

type ProfileRow = Prisma.ShopAdminGetPayload<{ select: ReturnType<typeof profileSelect> }>

/**
 * Worker settings deliberately receive a personal-account DTO only. In
 * particular, do not return a nested Shop object and accidentally expose
 * currency, package, ownership, or other shop-level metadata to a worker.
 */
function profileDto(
  admin: ProfileRow,
  input: { isStaff: boolean; telegramFeatureEnabled: boolean },
) {
  const { shop, telegramNotificationsEnabled, ...personal } = admin
  const telegramAllowed = !input.isStaff || (
    input.telegramFeatureEnabled &&
    telegramNotificationsEnabled &&
    shop.telegramNotificationsEnabled
  )

  return {
    ...personal,
    telegramNotificationsEnabled,
    memberKind: input.isStaff ? 'SHOP_STAFF' as const : 'SHOP_OWNER' as const,
    telegramAllowed,
    ...(input.isStaff
      ? {}
      : {
          shop: {
            id: shop.id,
            name: shop.name,
            shopNumber: shop.shopNumber,
          },
        }),
  }
}

export async function GET() {
  try {
    const guarded = await requireApiSession()
    if (!guarded.ok) return guarded.response
    const { session } = guarded

    if (session.user.role !== 'SHOP_ADMIN' || !session.user.shopId || !guarded.principal) {
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

    return ok(profileDto(admin, {
      isStaff: guarded.principal.memberKind === 'SHOP_STAFF',
      telegramFeatureEnabled: guarded.principal.enabledFeatures.has('TELEGRAM'),
    }))
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

    if (session.user.role !== 'SHOP_ADMIN' || !session.user.shopId || !guarded.principal) {
      return forbidden("Faqat do'kon adminlari uchun")
    }
    const isStaff = guarded.principal.memberKind === 'SHOP_STAFF'
    const telegramFeatureEnabled = guarded.principal.enabledFeatures.has('TELEGRAM')

    const body = await readLimitedJsonBody(req)
    if (typeof body === 'object' && body !== null && 'telegramId' in body) {
      const parsed = updateTelegramSchema.safeParse(body)

      if (!parsed.success) {
        const firstError = (parsed.error as ZodError).issues[0]?.message ?? "Noto'g'ri ma'lumot"
        return badRequest(firstError)
      }

      const telegramId = normalizeTelegramId(parsed.data.telegramId)
      if (telegramId) await reconcileLinkedTelegramIdentity(telegramId)
      await processDueTelegramDisableTransitions({ shopId: session.user.shopId, limit: 10 })
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
          telegramNotificationsEnabled: true,
          shop: { select: { telegramNotificationsEnabled: true } },
        },
      })

      if (!admin) return notFound("Admin topilmadi")
      const updated = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const locked = telegramId
          ? await linkShopAdminTelegramIdentityInTransaction(tx, {
            shopId: admin.shopId,
            shopAdminId: admin.id,
            telegramId,
          })
          : await unlinkShopAdminTelegramIdentityInTransaction(tx, {
            shopId: admin.shopId,
            shopAdminId: admin.id,
          })

        await tx.log.create({
          data: {
            shopId: admin.shopId,
            actorId: admin.id,
            actorType: 'SHOP_ADMIN',
            action: 'UPDATE_TELEGRAM_ID',
            targetType: 'ShopAdmin',
            targetId: admin.id,
            oldValue: {
              telegramId: locked.actor.telegramId,
              login: locked.actor.login,
              name: locked.actor.name,
            },
            newValue: { telegramId },
          },
        })

        return tx.shopAdmin.findUniqueOrThrow({
          where: { id: admin.id },
          select: profileSelect(),
        })
      })

      return ok(profileDto(updated, { isStaff, telegramFeatureEnabled }), telegramId ? 'Telegram ulanishi yangilandi.' : 'Telegram ulanishi o‘chirildi.')
    }

    if (typeof body === 'object' && body !== null && ('name' in body || 'phone' in body)) {
      if (isStaff) {
        return forbidden("Xodim ism yoki telefonini o'zgartira olmaydi. Bu ma'lumotni do'kon egasi yangilaydi.")
      }
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

      return ok(profileDto(updated, { isStaff, telegramFeatureEnabled }), 'Profil yangilandi.')
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
    if (err && typeof err === 'object' && 'code' in err && err.code === 'TELEGRAM_DISABLED') {
      return forbidden("Telegram funksiyasi do'kon yoki xodim uchun yoqilmagan")
    }
    if (err && typeof err === 'object' && 'code' in err && err.code === 'TELEGRAM_TAKEN') {
      return conflict('Bu Telegram hisobi boshqa foydalanuvchiga biriktirilgan.')
    }
    logger.error('[PATCH /api/shop-admin/profile]', { event: 'api.route_error', error: err })
    return serverError()
  }
}
