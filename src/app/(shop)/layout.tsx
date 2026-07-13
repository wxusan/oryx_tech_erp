import { redirect } from 'next/navigation'
import { ShopLayoutClient } from './shop-layout-client'
import { requireApiSession } from '@/lib/api-auth'
import { getShopCurrencyContext } from '@/lib/server/currency'
import { ShopCurrencyProvider } from '@/lib/use-shop-currency'
import { prisma } from '@/lib/prisma'
import { authenticatedQueryScope } from '@/lib/query-scope'
import { latestChangeCursorForSession } from '@/lib/server/change-events'
import { AuthenticatedQueryProvider } from '@/components/authenticated-query-provider'

export default async function ShopLayout({ children }: { children: React.ReactNode }) {
  const guarded = await requireApiSession()
  if (!guarded.ok || !guarded.shopId || !guarded.principal) redirect('/shop/login')

  const syncCursor = await latestChangeCursorForSession(guarded.session)
  const [currency, shop] = await Promise.all([
    getShopCurrencyContext(guarded.shopId),
    prisma.shop.findUnique({ where: { id: guarded.shopId }, select: { name: true } }),
  ])

  return (
    <AuthenticatedQueryProvider
      scope={authenticatedQueryScope({
        ...guarded.session.user,
        memberKind: guarded.principal.memberKind,
        authorizationVersion: guarded.principal.authorizationVersion,
        permissionVersion: guarded.principal.permissionVersion,
      })}
      initialCursor={syncCursor}
    >
      <ShopCurrencyProvider initialCurrency={currency}>
        <ShopLayoutClient
          shopName={shop?.name ?? "Do'kon"}
          adminName={guarded.session.user.name}
          memberKind={guarded.principal.memberKind}
          enabledFeatures={[...guarded.principal.enabledFeatures]}
          grantedPermissions={[...guarded.principal.grantedPermissions]}
          legacyFullAccess={guarded.principal.legacyFullAccess}
        >
          {children}
        </ShopLayoutClient>
      </ShopCurrencyProvider>
    </AuthenticatedQueryProvider>
  )
}
