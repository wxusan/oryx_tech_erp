import { redirect } from 'next/navigation'
import { ShopLayoutClient } from './shop-layout-client'
import { requireApiSession } from '@/lib/api-auth'
import { getShopCurrencyContext } from '@/lib/server/currency'
import { ShopCurrencyProvider } from '@/lib/use-shop-currency'

export default async function ShopLayout({ children }: { children: React.ReactNode }) {
  const guarded = await requireApiSession()
  if (!guarded.ok || !guarded.shopId) redirect('/shop/login')

  const currency = await getShopCurrencyContext(guarded.shopId)

  return (
    <ShopCurrencyProvider initialCurrency={currency}>
      <ShopLayoutClient>{children}</ShopLayoutClient>
    </ShopCurrencyProvider>
  )
}
