/**
 * GET   /api/shop/profile — the signed-in shop admin's own shop profile.
 * PATCH /api/shop/profile — edit safe shop profile fields (shop owner only).
 *
 * The shop owner may edit descriptive/contact fields of their OWN shop only:
 * name, ownerName, ownerPhone, address, note. Sensitive fields controlled by the
 * super admin (shopNumber, status, subscriptionDue, telegramGroupId) are NOT
 * editable here. Every edit is shop-scoped, validated, audit-logged and
 * cache-invalidated.
 */

import { NextRequest } from 'next/server'
import { z, ZodError } from 'zod'
import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { badRequest, forbidden, notFound, ok, serverError } from '@/lib/api-helpers'
import { requireCurrentShopAnyPermission } from '@/lib/api-auth'
import { principalHasPermission } from '@/lib/server/shop-access'
import { invalidateShopProfileMutation } from '@/lib/server/cache-tags'
import { getShopCurrencyContext } from '@/lib/server/currency'
import { logger } from '@/lib/logger'
import { phoneSchema } from '@/lib/validations'

function shopProfileSelect() {
  return {
    id: true,
    name: true,
    ownerName: true,
    ownerPhone: true,
    shopNumber: true,
    address: true,
    note: true,
    status: true,
    subscriptionDue: true,
    preferredCurrency: true,
    telegramNotificationsEnabled: true,
  } satisfies Prisma.ShopSelect
}

const updateShopProfileSchema = z.object({
  name: z.string().trim().min(2, "Do'kon nomi kamida 2 ta harfdan iborat bo'lishi kerak").optional(),
  ownerName: z.string().trim().min(2, "Egasi ismi kamida 2 ta harfdan iborat bo'lishi kerak").optional(),
  ownerPhone: phoneSchema.optional(),
  address: z.string().trim().optional(),
  note: z.string().trim().optional(),
  preferredCurrency: z.enum(['UZS', 'USD']).optional(),
  telegramNotificationsEnabled: z.boolean().optional(),
})

export async function GET() {
  try {
    const guarded = await requireCurrentShopAnyPermission([
      'SHOP_PROFILE_EDIT',
      'SHOP_CURRENCY_MANAGE',
      'SHOP_TELEGRAM_MANAGE',
    ])
    if (!guarded.ok) return guarded.response
    const { session } = guarded

    if (session.user.role !== 'SHOP_ADMIN' || !session.user.shopId) {
      return forbidden("Faqat do'kon adminlari uchun")
    }

    const shop = await prisma.shop.findFirst({
      where: { id: session.user.shopId, deletedAt: null },
      select: shopProfileSelect(),
    })

    if (!shop) return notFound("Do'kon topilmadi")

    const currency = await getShopCurrencyContext(shop.id)
    return ok({ ...shop, usdUzsRate: currency.usdUzsRate })
  } catch (err) {
    logger.error('[GET /api/shop/profile]', { event: 'api.route_error', error: err })
    return serverError()
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const guarded = await requireCurrentShopAnyPermission([
      'SHOP_PROFILE_EDIT',
      'SHOP_CURRENCY_MANAGE',
      'SHOP_TELEGRAM_MANAGE',
    ])
    if (!guarded.ok) return guarded.response
    const { session } = guarded

    if (session.user.role !== 'SHOP_ADMIN' || !session.user.shopId) {
      return forbidden("Faqat do'kon adminlari uchun")
    }
    const shopId = session.user.shopId

    const body: unknown = await req.json()
    const parsed = updateShopProfileSchema.safeParse(body)
    if (!parsed.success) {
      const firstError = (parsed.error as ZodError).issues[0]?.message ?? "Noto'g'ri ma'lumot"
      return badRequest(firstError)
    }
    const hasProfileFields = parsed.data.name !== undefined || parsed.data.ownerName !== undefined ||
      parsed.data.ownerPhone !== undefined || parsed.data.address !== undefined || parsed.data.note !== undefined
    const requiredPermissions = [
      [hasProfileFields, 'SHOP_PROFILE_EDIT'],
      [parsed.data.preferredCurrency !== undefined, 'SHOP_CURRENCY_MANAGE'],
      [parsed.data.telegramNotificationsEnabled !== undefined, 'SHOP_TELEGRAM_MANAGE'],
    ] as const
    for (const [included, permission] of requiredPermissions) {
      if (included && (!guarded.principal || !principalHasPermission(guarded.principal, permission))) {
        return forbidden("So'rovdagi barcha sozlamalar uchun alohida ruxsat kerak")
      }
    }
    const updateData = {
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.ownerName !== undefined ? { ownerName: parsed.data.ownerName } : {}),
      ...(parsed.data.ownerPhone !== undefined ? { ownerPhone: parsed.data.ownerPhone } : {}),
      ...(parsed.data.address !== undefined ? { address: parsed.data.address } : {}),
      ...(parsed.data.note !== undefined ? { note: parsed.data.note } : {}),
      ...(parsed.data.preferredCurrency !== undefined ? { preferredCurrency: parsed.data.preferredCurrency } : {}),
      ...(parsed.data.telegramNotificationsEnabled !== undefined ? { telegramNotificationsEnabled: parsed.data.telegramNotificationsEnabled } : {}),
    }
    if (Object.keys(updateData).length === 0) {
      return badRequest("O'zgartirish uchun ma'lumot kiritilmadi")
    }

    const existing = await prisma.shop.findFirst({
      where: { id: shopId, deletedAt: null },
      select: { id: true, name: true, ownerName: true, ownerPhone: true, address: true, note: true, preferredCurrency: true, telegramNotificationsEnabled: true },
    })
    if (!existing) return notFound("Do'kon topilmadi")
    if (
      parsed.data.telegramNotificationsEnabled !== undefined &&
      parsed.data.telegramNotificationsEnabled !== existing.telegramNotificationsEnabled &&
      !guarded.principal?.enabledFeatures.has('TELEGRAM')
    ) {
      return forbidden("Telegram moduli do'kon paketida yoqilmagan")
    }

    const updated = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.shop.update({ where: { id: shopId }, data: updateData })
      await tx.log.create({
        data: {
          shopId,
          actorId: session.user.id,
          actorType: 'SHOP_ADMIN',
          action: 'UPDATE',
          targetType: 'Shop',
          targetId: shopId,
          oldValue: {
            name: existing.name,
            ownerName: existing.ownerName,
            ownerPhone: existing.ownerPhone,
            address: existing.address,
            note: existing.note,
            preferredCurrency: existing.preferredCurrency,
            telegramNotificationsEnabled: existing.telegramNotificationsEnabled,
          },
          newValue: updateData,
        },
      })
      return tx.shop.findUniqueOrThrow({ where: { id: shopId }, select: shopProfileSelect() })
    })

    invalidateShopProfileMutation(shopId)

    const currency = await getShopCurrencyContext(shopId)
    return ok({ ...updated, usdUzsRate: currency.usdUzsRate }, "Do'kon ma'lumotlari yangilandi")
  } catch (err) {
    logger.error('[PATCH /api/shop/profile]', { event: 'api.route_error', error: err })
    return serverError()
  }
}
