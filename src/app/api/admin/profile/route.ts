import { NextRequest } from 'next/server'
import bcrypt from 'bcrypt'
import { z, ZodError } from 'zod'
import { Prisma } from '@/generated/prisma/client'
import { badRequest, conflict, notFound, ok, serverError } from '@/lib/api-helpers'
import { requireSuperAdmin } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'
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
    login: true,
    email: true,
    telegramId: true,
    telegramVerifiedAt: true,
    role: true,
    createdAt: true,
    updatedAt: true,
  } satisfies Prisma.SuperAdminSelect
}

export async function GET() {
  try {
    const guarded = await requireSuperAdmin()
    if (!guarded.ok) return guarded.response

    const admin = await prisma.superAdmin.findFirst({
      where: {
        id: guarded.session.user.id,
        deletedAt: null,
      },
      select: profileSelect(),
    })

    if (!admin) return notFound('Bosh admin topilmadi')

    return ok(admin)
  } catch (err) {
    console.error('[GET /api/admin/profile]', err)
    return serverError()
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const guarded = await requireSuperAdmin()
    if (!guarded.ok) return guarded.response

    const body: unknown = await req.json()
    if (typeof body === 'object' && body !== null && 'telegramId' in body) {
      const parsed = updateTelegramSchema.safeParse(body)

      if (!parsed.success) {
        const firstError = (parsed.error as ZodError).issues[0]?.message ?? "Noto'g'ri ma'lumot"
        return badRequest(firstError)
      }

      const telegramId = normalizeTelegramId(parsed.data.telegramId)
      const admin = await prisma.superAdmin.findFirst({
        where: {
          id: guarded.session.user.id,
          deletedAt: null,
        },
        select: {
          id: true,
          name: true,
          login: true,
          email: true,
          telegramId: true,
        },
      })

      if (!admin) return notFound('Bosh admin topilmadi')
      if (telegramId && (await isTelegramIdTaken(telegramId, { type: 'SUPER_ADMIN', id: admin.id }))) {
        return conflict(`Bu Telegram ID allaqachon tizimda bor: ${telegramId}`)
      }

      const updated = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.superAdmin.update({
          where: { id: admin.id },
          data: {
            telegramId,
            telegramVerifiedAt: telegramId ? new Date() : null,
          },
        })

        await tx.log.create({
          data: {
            shopId: null,
            actorId: admin.id,
            actorType: 'SUPER_ADMIN',
            action: 'UPDATE_TELEGRAM_ID',
            targetType: 'SuperAdmin',
            targetId: admin.id,
            oldValue: { telegramId: admin.telegramId, login: admin.login ?? admin.email, name: admin.name },
            newValue: { telegramId },
          },
        })

        return tx.superAdmin.findUniqueOrThrow({
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

    const admin = await prisma.superAdmin.findFirst({
      where: {
        id: guarded.session.user.id,
        deletedAt: null,
      },
      select: {
        id: true,
        name: true,
        login: true,
        email: true,
        passwordHash: true,
      },
    })

    if (!admin) return notFound('Bosh admin topilmadi')

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
      await tx.superAdmin.update({
        where: { id: admin.id },
        data: {
          passwordHash,
          sessionVersion: { increment: 1 },
        },
      })

      await tx.log.create({
        data: {
          shopId: null,
          actorId: admin.id,
          actorType: 'SUPER_ADMIN',
          action: 'CHANGE_PASSWORD',
          targetType: 'SuperAdmin',
          targetId: admin.id,
          oldValue: { login: admin.login ?? admin.email, name: admin.name },
          newValue: { passwordChanged: true },
        },
      })
    })

    return ok({ passwordChanged: true }, 'Parol yangilandi. Qayta kiring.')
  } catch (err) {
    console.error('[PATCH /api/admin/profile]', err)
    return serverError()
  }
}
