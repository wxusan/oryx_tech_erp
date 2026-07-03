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

export function nextTelegramVerifiedAt<T extends Date | string | null>(
  currentTelegramId: string | null | undefined,
  currentTelegramVerifiedAt: T,
  nextTelegramId: string | null,
): T | null {
  if (nextTelegramId && currentTelegramId === nextTelegramId) {
    return currentTelegramVerifiedAt
  }

  return null
}

export async function findTelegramOwner(telegramId: string) {
  const [superAdmin, shopAdmin] = await Promise.all([
    prisma.superAdmin.findFirst({
      where: { telegramId, deletedAt: null },
      select: { id: true, name: true, login: true },
    }),
    prisma.shopAdmin.findFirst({
      where: {
        telegramId,
        deletedAt: null,
        isActive: true,
        shop: { deletedAt: null, status: 'ACTIVE' },
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
