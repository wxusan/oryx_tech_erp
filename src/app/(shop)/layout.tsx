import { redirect } from 'next/navigation'
import { ShopLayoutClient } from './shop-layout-client'
import { requireApiSession } from '@/lib/api-auth'
import { getShopCurrencyContext } from '@/lib/server/currency'
import { ShopCurrencyProvider } from '@/lib/use-shop-currency'
import { prisma } from '@/lib/prisma'
import { authenticatedQueryScope } from '@/lib/query-scope'
import { latestChangeCursorForSession } from '@/lib/server/change-events'
import { AuthenticatedQueryProvider } from '@/components/authenticated-query-provider'
import { principalHasFeature, principalHasPermission } from '@/lib/server/shop-access'

export default async function ShopLayout({ children }: { children: React.ReactNode }) {
  const guarded = await requireApiSession()
  if (!guarded.ok || !guarded.shopId || !guarded.principal) redirect('/shop/login')

  // Capability checks are cheap local set lookups. Keep the banner itself
  // client-fetched so every navigation avoids blocking on its aggregate.
  const includeCashSales = principalHasFeature(guarded.principal, 'CASH_SALES') && (
    principalHasPermission(guarded.principal, 'RECEIVABLES_VIEW') ||
    principalHasPermission(guarded.principal, 'SALE_VIEW') ||
    principalHasPermission(guarded.principal, 'SALE_PAYMENT_RECEIVE')
  )
  const includeNasiya = principalHasFeature(guarded.principal, 'NASIYA') && (
    principalHasPermission(guarded.principal, 'RECEIVABLES_VIEW') ||
    principalHasPermission(guarded.principal, 'NASIYA_VIEW') ||
    principalHasPermission(guarded.principal, 'NASIYA_PAYMENT_RECEIVE') ||
    principalHasPermission(guarded.principal, 'NASIYA_DEFER')
  )
  const [syncCursor, currency, shop] = await Promise.all([
    latestChangeCursorForSession(guarded.session),
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
          sessionPolicy={guarded.session.user.sessionPolicy}
          initialDueSummary={null}
          initialCanSeeReceivables={includeCashSales || includeNasiya}
        >
          {children}
        </ShopLayoutClient>
      </ShopCurrencyProvider>
    </AuthenticatedQueryProvider>
  )
}
