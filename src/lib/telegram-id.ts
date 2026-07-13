import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { tashkentTodayInputValue } from '@/lib/timezone'

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
        telegramNotificationsEnabled: true,
        shop: { deletedAt: null, status: 'ACTIVE', telegramNotificationsEnabled: true },
      },
      select: {
        id: true,
        name: true,
        login: true,
        shop: {
          select: {
            id: true,
            name: true,
            status: true,
            ownerAdminId: true,
            packageVersions: {
              where: { effectiveOn: { lte: new Date(`${tashkentTodayInputValue()}T00:00:00.000Z`) } },
              orderBy: [{ effectiveOn: 'desc' }, { createdAt: 'desc' }],
              take: 1,
              select: { features: { select: { featureCode: true, enabled: true } } },
            },
          },
        },
      },
    }),
  ])

  if (superAdmin) {
    return { type: 'SUPER_ADMIN' as const, user: superAdmin }
  }

  if (shopAdmin) {
    const enabled = new Set(shopAdmin.shop.packageVersions[0]?.features
      .filter((feature) => feature.enabled)
      .map((feature) => feature.featureCode) ?? [])
    const memberAllowed = shopAdmin.id === shopAdmin.shop.ownerAdminId || enabled.has('STAFF_ACCESS')
    if (!enabled.has('TELEGRAM') || !memberAllowed) return null
    return { type: 'SHOP_ADMIN' as const, user: shopAdmin }
  }

  return null
}

export async function isTelegramIdTaken(
  telegramId: string,
  current?: { type: 'SUPER_ADMIN' | 'SHOP_ADMIN'; id: string },
) {
  // Reserve an ID for every non-deleted actor, including an inactive shop
  // admin. This mirrors the database's live-identity constraint and prevents
  // an inactive account from becoming ambiguous when it is reactivated.
  const [superAdmin, shopAdmin] = await Promise.all([
    prisma.superAdmin.findFirst({
      where: {
        telegramId,
        deletedAt: null,
        ...(current?.type === 'SUPER_ADMIN' ? { id: { not: current.id } } : {}),
      },
      select: { id: true },
    }),
    prisma.shopAdmin.findFirst({
      where: {
        telegramId,
        deletedAt: null,
        ...(current?.type === 'SHOP_ADMIN' ? { id: { not: current.id } } : {}),
      },
      select: { id: true },
    }),
  ])
  return Boolean(superAdmin || shopAdmin)
}

export type TelegramOwner = NonNullable<Awaited<ReturnType<typeof findTelegramOwner>>>
