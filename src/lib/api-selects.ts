import type { Prisma } from '@/generated/prisma/client'

export const shopAdminPublicSelect = {
  id: true,
  shopId: true,
  name: true,
  phone: true,
  login: true,
  telegramId: true,
  telegramVerifiedAt: true,
  isActive: true,
  permissionVersion: true,
  legacyFullAccess: true,
  telegramNotificationsEnabled: true,
  createdAt: true,
  deletedAt: true,
  deletedBy: true,
  deleteNote: true,
} satisfies Prisma.ShopAdminSelect
