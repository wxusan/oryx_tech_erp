import { redirect } from 'next/navigation'
import { requireApiSession } from '@/lib/api-auth'
import { principalHasPermission } from '@/lib/server/shop-access'
import { getShopAdminSettingsProfile, getShopSettingsProfile } from '@/lib/server/shop-settings'
import { ShopSettingsInitialDataProvider } from '@/components/shop/settings-initial-data'

export default async function ShopSettingsLayout({ children }: { children: React.ReactNode }) {
  const guarded = await requireApiSession()
  if (!guarded.ok || !guarded.shopId || !guarded.principal || guarded.session.user.role !== 'SHOP_ADMIN') {
    redirect('/shop/dashboard')
  }
  const canManageShop = ['SHOP_PROFILE_EDIT', 'SHOP_CURRENCY_MANAGE', 'SHOP_TELEGRAM_MANAGE']
    .some((permission) => principalHasPermission(
      guarded.principal!,
      permission as 'SHOP_PROFILE_EDIT' | 'SHOP_CURRENCY_MANAGE' | 'SHOP_TELEGRAM_MANAGE',
    ))
  const [profile, shop] = await Promise.all([
    getShopAdminSettingsProfile({
      actorId: guarded.session.user.id,
      shopId: guarded.shopId,
      principal: guarded.principal,
    }),
    canManageShop ? getShopSettingsProfile(guarded.shopId) : Promise.resolve(null),
  ])
  if (!profile) redirect('/shop/dashboard')

  return <ShopSettingsInitialDataProvider value={{ profile, shop }}>{children}</ShopSettingsInitialDataProvider>
}
