/**
 * POST   /api/shops/[id]/admins — add a new admin to a shop (super admin only)
 * PATCH  /api/shops/[id]/admins — reset a shop admin password (super admin only)
 * DELETE /api/shops/[id]/admins — soft-delete a shop admin (super admin only)
 */

import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/generated/prisma/client'
import bcrypt from 'bcrypt'
import { ok, created, badRequest, conflict, notFound, serverError } from '@/lib/api-helpers'
import { requireSuperAdmin } from '@/lib/api-auth'
import { shopAdminPublicSelect } from '@/lib/api-selects'
import { isTelegramIdTaken, normalizeTelegramId } from '@/lib/telegram-id'
import { z, ZodError } from 'zod'

type RouteContext = { params: Promise<{ id: string }> }

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const addAdminSchema = z.object({
  name: z
    .string({ error: "Admin ismi kiritilishi shart" })
    .min(2, "Ism kamida 2 ta harfdan iborat bo'lishi kerak"),
  phone: z
    .string({ error: "Telefon raqam kiritilishi shart" })
    .min(9, "Telefon raqam kamida 9 ta raqam bo'lishi kerak"),
  telegramId: z
    .string()
    .trim()
    .regex(/^\d{5,20}$/, "Telegram ID faqat raqamlardan iborat bo'lishi kerak")
    .optional()
    .or(z.literal('')),
  login: z
    .string({ error: "Login kiritilishi shart" })
    .min(3, "Login kamida 3 ta belgidan iborat bo'lishi kerak"),
  password: z
    .string({ error: "Parol kiritilishi shart" })
    .min(6, "Parol kamida 6 ta belgidan iborat bo'lishi kerak"),
})

const deleteAdminSchema = z.object({
  adminId: z.string({ error: "Admin ID kiritilishi shart" }).min(1),
  note: z
    .string({ error: "O'chirish sababi kiritilishi shart" })
    .min(5, "O'chirish sababi kamida 5 ta belgidan iborat bo'lishi kerak"),
})

const resetPasswordSchema = z.object({
  adminId: z.string({ error: "Admin ID kiritilishi shart" }).min(1),
  password: z
    .string({ error: "Yangi parol kiritilishi shart" })
    .min(6, "Parol kamida 6 ta belgidan iborat bo'lishi kerak"),
  note: z
    .string({ error: "Sabab kiritilishi shart" })
    .min(5, "Sabab kamida 5 ta belgidan iborat bo'lishi kerak"),
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
    const body: unknown = await req.json()
    const parsed = addAdminSchema.safeParse(body)

    if (!parsed.success) {
      const firstError = (parsed.error as ZodError).issues[0]?.message ?? "Noto'g'ri ma'lumot"
      return badRequest(firstError)
    }

    const shop = await prisma.shop.findFirst({ where: { id, deletedAt: null } })
    if (!shop) return notFound("Do'kon topilmadi")

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

    const admin = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const newAdmin = await tx.shopAdmin.create({
        data: {
          shopId: id,
          name: parsed.data.name,
          phone: parsed.data.phone,
          login: parsed.data.login,
          telegramId,
          telegramVerifiedAt: telegramId ? new Date() : null,
          passwordHash,
        },
      })

      await tx.log.create({
        data: {
          shopId: id,
          actorId: session.user.id,
          actorType: 'SUPER_ADMIN',
          action: 'CREATE',
          targetType: 'ShopAdmin',
          targetId: newAdmin.id,
          newValue: { name: parsed.data.name, phone: parsed.data.phone, login: parsed.data.login },
        },
      })

      return tx.shopAdmin.findUniqueOrThrow({
        where: { id: newAdmin.id },
        select: shopAdminPublicSelect,
      })
    })

    return created(admin, "Admin muvaffaqiyatli qo'shildi")
  } catch (err) {
    console.error('[POST /api/shops/[id]/admins]', err)
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
    const body: unknown = await req.json()
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
    console.error('[PATCH /api/shops/[id]/admins]', err)
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
    const body: unknown = await req.json()
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
    console.error('[DELETE /api/shops/[id]/admins]', err)
    return serverError()
  }
}
