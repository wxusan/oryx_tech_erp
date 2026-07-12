import { redirect } from 'next/navigation'
import { ShopLayoutClient } from './shop-layout-client'
import { requireApiSession } from '@/lib/api-auth'
import { getShopCurrencyContext } from '@/lib/server/currency'
import { ShopCurrencyProvider } from '@/lib/use-shop-currency'
import { prisma } from '@/lib/prisma'

export default async function ShopLayout({ children }: { children: React.ReactNode }) {
  const guarded = await requireApiSession()
  if (!guarded.ok || !guarded.shopId) redirect('/shop/login')

  const [currency, shop] = await Promise.all([
    getShopCurrencyContext(guarded.shopId),
    prisma.shop.findUnique({ where: { id: guarded.shopId }, select: { name: true } }),
  ])

  return (
    <ShopCurrencyProvider initialCurrency={currency}>
      <ShopLayoutClient shopName={shop?.name ?? "Do'kon"} adminName={guarded.session.user.name}>
        {children}
      </ShopLayoutClient>
    </ShopCurrencyProvider>
  )
}
