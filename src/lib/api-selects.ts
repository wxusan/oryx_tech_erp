import type { Prisma } from '@/generated/prisma/client'

export const shopAdminPublicSelect = {
  id: true,
  shopId: true,
  name: true,
  phone: true,
  login: true,
  telegramId: true,
  telegramVerifiedAt: true,
  telegramLinkCode: true,
  isActive: true,
  createdAt: true,
  deletedAt: true,
  deletedBy: true,
  deleteNote: true,
} satisfies Prisma.ShopAdminSelect
