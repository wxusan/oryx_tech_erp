import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { tashkentTodayInputValue } from '@/lib/timezone'
import { reconcileLinkedTelegramIdentity } from '@/lib/server/telegram-lifecycle'

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
  await reconcileLinkedTelegramIdentity(telegramId)

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
        shop: { deletedAt: null, status: 'ACTIVE', telegramNotificationsEnabled: true },
      },
      select: {
        id: true,
        name: true,
        login: true,
        telegramNotificationsEnabled: true,
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
    const isOwner = shopAdmin.id === shopAdmin.shop.ownerAdminId
    const memberAllowed = isOwner || (
      shopAdmin.telegramNotificationsEnabled && enabled.has('STAFF_ACCESS')
    )
    if (!enabled.has('TELEGRAM') || !memberAllowed) return null
    return { type: 'SHOP_ADMIN' as const, user: shopAdmin }
  }

  return null
}

export async function isTelegramIdTaken(
  telegramId: string,
  current?: { type: 'SUPER_ADMIN' | 'SHOP_ADMIN'; id: string },
) {
  const lookup = () => Promise.all([
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
      select: { id: true, shopId: true },
    }),
  ] as const)
  let [superAdmin, shopAdmin] = await lookup()
  // Free IDs stay on the two-query parallel fast path. Reconciliation is only
  // needed when a historic ShopAdmin row is actually reserving the value.
  if (shopAdmin) {
    await reconcileLinkedTelegramIdentity(telegramId)
    ;[superAdmin, shopAdmin] = await lookup()
  }
  return Boolean(superAdmin || shopAdmin)
}

export type TelegramOwner = NonNullable<Awaited<ReturnType<typeof findTelegramOwner>>>
