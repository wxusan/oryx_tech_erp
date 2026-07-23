import 'server-only'

import type { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import type { ShopPrincipal } from '@/lib/server/shop-access'
import { getShopCurrencyContext } from '@/lib/server/currency'
import type { ShopAdminProfileDto, ShopProfileDto } from '@/lib/shop-settings-contract'

export const shopAdminProfileSelect = {
  id: true,
  name: true,
  phone: true,
  login: true,
  telegramId: true,
  telegramVerifiedAt: true,
  telegramNotificationsEnabled: true,
  passwordChangedAt: true,
  shop: {
    select: {
      id: true,
      name: true,
      shopNumber: true,
      telegramNotificationsEnabled: true,
    },
  },
} satisfies Prisma.ShopAdminSelect

export type ShopAdminProfileRow = Prisma.ShopAdminGetPayload<{ select: typeof shopAdminProfileSelect }>

export function shopAdminProfileDto(
  admin: ShopAdminProfileRow,
  input: { isStaff: boolean; telegramFeatureEnabled: boolean },
): ShopAdminProfileDto {
  const { shop, telegramNotificationsEnabled, ...personal } = admin
  const telegramAllowed = !input.isStaff || (
    input.telegramFeatureEnabled &&
    telegramNotificationsEnabled &&
    shop.telegramNotificationsEnabled
  )
  return {
    ...personal,
    telegramId: personal.telegramId,
    telegramVerifiedAt: personal.telegramVerifiedAt?.toISOString() ?? null,
    passwordChangedAt: personal.passwordChangedAt.toISOString(),
    memberKind: input.isStaff ? 'SHOP_STAFF' : 'SHOP_OWNER',
    telegramAllowed,
    ...(input.isStaff ? {} : { shop: { id: shop.id, name: shop.name, shopNumber: shop.shopNumber } }),
  }
}

export const shopProfileSelect = {
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

export async function getShopAdminSettingsProfile(input: {
  actorId: string
  shopId: string
  principal: ShopPrincipal
}): Promise<ShopAdminProfileDto | null> {
  const admin = await prisma.shopAdmin.findFirst({
    where: { id: input.actorId, shopId: input.shopId, isActive: true, deletedAt: null },
    select: shopAdminProfileSelect,
  })
  return admin ? shopAdminProfileDto(admin, {
    isStaff: input.principal.memberKind === 'SHOP_STAFF',
    telegramFeatureEnabled: input.principal.enabledFeatures.has('TELEGRAM'),
  }) : null
}

export async function getShopSettingsProfile(shopId: string): Promise<ShopProfileDto | null> {
  const [shop, currency] = await Promise.all([
    prisma.shop.findFirst({ where: { id: shopId, deletedAt: null }, select: shopProfileSelect }),
    getShopCurrencyContext(shopId),
  ])
  return shop ? {
    ...shop,
    subscriptionDue: shop.subscriptionDue.toISOString(),
    usdUzsRate: currency.usdUzsRate,
    usdUzsRateSource: currency.usdUzsRateSource ?? null,
    usdUzsRateFetchedAt: currency.usdUzsRateFetchedAt ?? null,
    fxQuote: currency.fxQuote ?? null,
  } : null
}
