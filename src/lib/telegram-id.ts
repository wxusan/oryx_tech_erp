import { z } from 'zod'
import { prisma } from '@/lib/prisma'

export const telegramIdSchema = z
  .string()
  .trim()
  .regex(/^\d{5,20}$/, "Telegram ID faqat raqamlardan iborat bo'lishi kerak")

export function normalizeTelegramId(value: string | null | undefined) {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

export async function findTelegramOwner(telegramId: string) {
  const [superAdmin, shopAdmin] = await Promise.all([
    prisma.superAdmin.findFirst({
      where: { telegramId, deletedAt: null },
      select: { id: true, name: true, email: true },
    }),
    prisma.shopAdmin.findFirst({
      where: {
        telegramId,
        deletedAt: null,
        isActive: true,
        shop: { deletedAt: null },
      },
      select: {
        id: true,
        name: true,
        login: true,
        shop: { select: { id: true, name: true, status: true } },
      },
    }),
  ])

  if (superAdmin) {
    return { type: 'SUPER_ADMIN' as const, user: superAdmin }
  }

  if (shopAdmin) {
    return { type: 'SHOP_ADMIN' as const, user: shopAdmin }
  }

  return null
}

export async function isTelegramIdTaken(
  telegramId: string,
  current?: { type: 'SUPER_ADMIN' | 'SHOP_ADMIN'; id: string },
) {
  const owner = await findTelegramOwner(telegramId)
  if (!owner) return false
  return owner.type !== current?.type || owner.user.id !== current.id
}

export type TelegramOwner = NonNullable<Awaited<ReturnType<typeof findTelegramOwner>>>

/** Message shown when a Telegram user is not linked to any Oryx ERP account. */
export const START_NOT_LINKED_MESSAGE =
  "Telegram akkauntingiz hali Oryx ERP hisobiga ulanmagan. Admin panelda Telegram ID kiriting yoki /link KOD yuboring."

/**
 * Build the /start welcome message for a recognised owner. Pure function so it
 * can be unit-tested without a database. Role-specific: super admins get a
 * generic welcome, shop admins get their shop name.
 */
export function buildStartWelcome(owner: TelegramOwner): string {
  if (owner.type === 'SUPER_ADMIN') {
    return `Assalomu alaykum, ${owner.user.name}. Siz Oryx ERP super admin sifatida ulandingiz.`
  }

  return (
    `Assalomu alaykum, ${owner.user.name}. ` +
    `Siz ${owner.user.shop.name} do'koni uchun Oryx ERP bildirishnomalariga ulandingiz.`
  )
}
