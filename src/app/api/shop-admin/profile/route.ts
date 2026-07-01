import { NextRequest } from 'next/server'
import bcrypt from 'bcrypt'
import { z, ZodError } from 'zod'
import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { badRequest, conflict, forbidden, notFound, ok, serverError } from '@/lib/api-helpers'
import { requireApiSession } from '@/lib/api-auth'
import { isTelegramIdTaken, normalizeTelegramId } from '@/lib/telegram-id'

const changePasswordSchema = z.object({
  currentPassword: z.string({ error: 'Joriy parol kiritilishi shart' }).min(1, 'Joriy parol kiritilishi shart'),
  newPassword: z
    .string({ error: 'Yangi parol kiritilishi shart' })
    .min(8, "Yangi parol kamida 8 ta belgidan iborat bo'lishi kerak"),
})

const updateTelegramSchema = z.object({
  telegramId: z
    .string()
    .trim()
    .regex(/^\d{5,20}$/, "Telegram ID faqat raqamlardan iborat bo'lishi kerak")
    .optional()
    .or(z.literal('')),
})

function profileSelect() {
  return {
    id: true,
    name: true,
    phone: true,
    login: true,
    telegramId: true,
    telegramVerifiedAt: true,
    telegramLinkCode: true,
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
    console.error('[GET /api/shop-admin/profile]', err)
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

    const body: unknown = await req.json()
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
            telegramVerifiedAt: telegramId ? new Date() : null,
            telegramLinkCode: telegramId ? null : undefined,
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
    console.error('[PATCH /api/shop-admin/profile]', err)
    return serverError()
  }
}
