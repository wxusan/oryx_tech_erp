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
import { getReceivableCohortSummaries } from '@/lib/server/shop-stats-queries'
import { tashkentDayRange } from '@/lib/timezone'

export default async function ShopLayout({ children }: { children: React.ReactNode }) {
  const guarded = await requireApiSession()
  if (!guarded.ok || !guarded.shopId || !guarded.principal) redirect('/shop/login')

  const canSeeFinancialOverview = guarded.principal.memberKind === 'SHOP_OWNER'
  const includeCashSales = canSeeFinancialOverview && principalHasFeature(guarded.principal, 'CASH_SALES') &&
    principalHasPermission(guarded.principal, 'INVENTORY_VIEW')
  const includeNasiya = canSeeFinancialOverview && principalHasFeature(guarded.principal, 'NASIYA') &&
    principalHasPermission(guarded.principal, 'NASIYA_VIEW')
  const { start: todayStart, end: tomorrowStart, dayKey } = tashkentDayRange(new Date())
  const [syncCursor, currency, shop, dueCohorts] = await Promise.all([
    latestChangeCursorForSession(guarded.session),
    getShopCurrencyContext(guarded.shopId),
    prisma.shop.findUnique({ where: { id: guarded.shopId }, select: { name: true } }),
    includeCashSales || includeNasiya
      ? getReceivableCohortSummaries({
          shopId: guarded.shopId,
          todayStart,
          tomorrowStart,
          includeCashSales,
          includeNasiya,
        })
      : Promise.resolve(null),
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
          initialDueSummary={dueCohorts ? {
            dueToday: dueCohorts.DUE_TODAY,
            overdue: dueCohorts.OVERDUE,
            currency,
            dayKey,
          } : null}
        >
          {children}
        </ShopLayoutClient>
      </ShopCurrencyProvider>
    </AuthenticatedQueryProvider>
  )
}
