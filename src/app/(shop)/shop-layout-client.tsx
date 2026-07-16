'use client'

import Link from 'next/link'
import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Smartphone, CreditCard, Plus, BarChart3, Users, ScrollText, Settings, UserCog, WalletCards, ShoppingBag } from 'lucide-react'
import { SessionControls } from '@/components/auth/session-controls'
import { Badge } from '@/components/ui/badge'
import { DueOverdueBanner, type DueOverdueSummary } from '@/components/shop/due-overdue-banner'
import {
  principalCan,
  type ShopFeatureCode,
  type ShopMemberKind,
  type ShopPermissionCode,
} from '@/lib/access-control'
import { ShopAccessProvider } from '@/components/shop/shop-access-context'
import { measureAuthenticatedShellUsable } from '@/lib/login-performance'
import { NavigationLinkStatus } from '@/components/navigation-link-status'
import { markNavigationIntent, markNavigationSettled } from '@/lib/client-performance'

const navLinks = [
  { href: '/shop/dashboard', label: 'Boshqaruv', icon: LayoutDashboard, prefetch: true, permission: null, anyPermissions: ['DASHBOARD_OPERATIONAL_VIEW', 'DASHBOARD_FINANCIAL_VIEW'], ownerOnly: false, sidebar: true, header: false },
  { href: '/shop/yangi-operatsiya', label: 'Yangi operatsiya', icon: Plus, prefetch: true, permission: null, anyPermissions: ['DEVICE_CREATE', 'SALE_CREATE', 'NASIYA_CREATE', 'OLIB_CREATE', 'SALE_PAYMENT_RECEIVE', 'NASIYA_PAYMENT_RECEIVE'], ownerOnly: false, sidebar: true, header: true },
  { href: '/shop/qurilmalar', label: 'Qurilmalar', icon: Smartphone, prefetch: true, permission: null, anyPermissions: ['INVENTORY_VIEW', 'DEVICE_EDIT', 'DEVICE_DELETE', 'DEVICE_RESTOCK', 'SALE_RETURN_REFUND'], ownerOnly: false, sidebar: true, header: false },
  { href: '/shop/sotuvlar', label: 'Sotuvlar', icon: ShoppingBag, prefetch: true, permission: null, anyPermissions: ['SALE_VIEW', 'SALE_EDIT', 'SALE_REMINDER_MANAGE'], ownerOnly: false, sidebar: true, header: false },
  { href: '/shop/nasiyalar', label: 'Nasiyalar', icon: CreditCard, prefetch: true, permission: null, anyPermissions: ['NASIYA_VIEW', 'NASIYA_EDIT', 'NASIYA_REMINDER_MANAGE', 'NASIYA_ARCHIVE', 'NASIYA_REOPEN'], ownerOnly: false, sidebar: true, header: false },
  { href: '/shop/tolovlar', label: "To'lovlar", icon: WalletCards, prefetch: true, permission: null, anyPermissions: ['RECEIVABLES_VIEW', 'SALE_VIEW', 'SALE_PAYMENT_RECEIVE', 'NASIYA_VIEW', 'NASIYA_PAYMENT_RECEIVE', 'NASIYA_DEFER'], ownerOnly: false, sidebar: true, header: false },
  { href: '/shop/mijozlar', label: 'Mijozlar', icon: Users, prefetch: true, permission: null, anyPermissions: ['CUSTOMER_VIEW', 'CUSTOMER_CREATE', 'CUSTOMER_EDIT', 'CUSTOMER_PASSPORT_PHOTO_VIEW', 'CUSTOMER_PASSPORT_REVEAL', 'CUSTOMER_PASSPORT_MANAGE', 'CUSTOMER_TRUST_OVERRIDE'], ownerOnly: false, sidebar: true, header: false },
  { href: '/shop/hisobot', label: 'Hisobot', icon: BarChart3, prefetch: true, permission: 'REPORT_VIEW', anyPermissions: [], ownerOnly: false, sidebar: false, header: true },
  { href: '/shop/logs', label: 'Loglar', icon: ScrollText, prefetch: true, permission: 'LOG_VIEW', anyPermissions: [], ownerOnly: false, sidebar: true, header: false },
  { href: '/shop/xodimlar', label: 'Xodimlar', icon: UserCog, prefetch: true, permission: null, anyPermissions: ['STAFF_VIEW', 'STAFF_CREATE', 'STAFF_EDIT_PROFILE', 'STAFF_RESET_PASSWORD', 'STAFF_STATUS_MANAGE', 'STAFF_DELETE', 'STAFF_PERMISSION_MANAGE', 'STAFF_NOTIFICATION_MANAGE'], ownerOnly: false, sidebar: true, header: false },
  { href: '/shop/settings', label: 'Sozlamalar', icon: Settings, prefetch: true, permission: null, anyPermissions: [], ownerOnly: false, sidebar: true, header: false },
] satisfies Array<{
  href: string
  label: string
  icon: typeof LayoutDashboard
  prefetch: boolean
  permission: ShopPermissionCode | null
  anyPermissions: ShopPermissionCode[]
  ownerOnly: boolean
  sidebar: boolean
  header: boolean
}>

function initials(name: string) {
  return name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'DA'
}

export function ShopLayoutClient({
  children,
  shopName,
  adminName,
  memberKind,
  enabledFeatures,
  grantedPermissions,
  legacyFullAccess,
  sessionPolicy,
  initialDueSummary,
  initialCanSeeReceivables,
}: {
  children: React.ReactNode
  shopName: string
  adminName: string
  memberKind: ShopMemberKind
  enabledFeatures: ShopFeatureCode[]
  grantedPermissions: ShopPermissionCode[]
  legacyFullAccess: boolean
  sessionPolicy: 'IDLE_10_MINUTES' | 'REMEMBERED_30_DAYS'
  initialDueSummary: DueOverdueSummary | null
  initialCanSeeReceivables: boolean
}) {
  const pathname = usePathname()
  useEffect(() => {
    measureAuthenticatedShellUsable('shop')
  }, [])
  useEffect(() => {
    markNavigationSettled(pathname)
  }, [pathname])
  const principal = {
    memberKind,
    legacyFullAccess,
    enabledFeatures: new Set(enabledFeatures),
    grantedPermissions: new Set(grantedPermissions),
  }
  const permittedNavLinks = navLinks.filter((link) =>
    (!link.ownerOnly || memberKind === 'SHOP_OWNER') &&
    (!link.permission || principalCan(principal, link.permission)) &&
    (!link.anyPermissions.length || link.anyPermissions.some((permission) => principalCan(principal, permission))),
  )
  const visibleSidebarLinks = permittedNavLinks.filter((link) => link.sidebar)
  const visibleHeaderLinks = permittedNavLinks.filter((link) => link.header)
  const canSeeReceivables = initialCanSeeReceivables && [
    'RECEIVABLES_VIEW',
    'SALE_VIEW',
    'SALE_PAYMENT_RECEIVE',
    'NASIYA_VIEW',
    'NASIYA_PAYMENT_RECEIVE',
    'NASIYA_DEFER',
  ].some((permission) => principalCan(principal, permission as ShopPermissionCode))

  return (
    <ShopAccessProvider
      memberKind={memberKind}
      enabledFeatures={enabledFeatures}
      grantedPermissions={grantedPermissions}
      legacyFullAccess={legacyFullAccess}
    >
      <div className="flex min-h-screen flex-col bg-zinc-50 md:h-screen md:flex-row md:overflow-hidden">
      <aside className="flex w-full flex-shrink-0 flex-col border-b border-zinc-200 bg-white/95 md:w-64 md:border-b-0 md:border-r">
        <div className="px-4 py-5 border-b border-zinc-200">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="font-bold text-lg text-zinc-900 leading-none">Oryx ERP</div>
              <div className="text-xs text-zinc-500 mt-1">Do&apos;kon portali</div>
            </div>
            <Badge variant="secondary" className="rounded-md">Faol</Badge>
          </div>
        </div>

        <nav className="flex gap-1 overflow-x-auto px-2 py-3 md:block md:flex-1 md:space-y-0.5">
          {visibleSidebarLinks.map(({ href, label, icon: Icon, prefetch }) => {
            const isActive = pathname === href || pathname.startsWith(href + '/')
            return (
              <Link
                key={href}
                href={href}
                prefetch={prefetch}
                onClick={() => markNavigationIntent(href)}
                className={`flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                  isActive
                    ? 'bg-zinc-900 font-medium text-white shadow-sm'
                    : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900'
                }`}
              >
                <Icon size={16} className="flex-shrink-0" />
                <span>{label}</span>
                <NavigationLinkStatus href={href} />
              </Link>
            )
          })}
        </nav>

        <div className="p-4 border-t border-zinc-200">
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
            <div className="truncate text-xs font-medium text-zinc-900">{shopName}</div>
            <div className="mt-1 text-xs text-zinc-500">{memberKind === 'SHOP_OWNER' ? 'Ombor, nasiya, hisobot' : 'Operatsiyalar va mijozlar'}</div>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col md:overflow-hidden">
        <header className="sticky top-0 z-40 flex h-14 flex-shrink-0 items-center justify-between gap-2 border-b border-zinc-200 bg-white/90 px-4 backdrop-blur sm:px-6">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <span className="hidden text-sm font-medium text-zinc-900 sm:inline">Do&apos;kon portali</span>
            {visibleHeaderLinks.length > 0 && (
              <nav className="flex items-center gap-1" aria-label="Tezkor navigatsiya">
                {visibleHeaderLinks.map(({ href, label, icon: Icon, prefetch }) => {
                  const isActive = pathname === href || pathname.startsWith(href + '/')
                  const isPrimaryAction = href === '/shop/yangi-operatsiya'
                  return (
                    <Link
                      key={href}
                      href={href}
                      prefetch={prefetch}
                      onClick={() => markNavigationIntent(href)}
                      aria-label={label}
                      title={label}
                      className={`inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors sm:px-2.5 ${
                        isPrimaryAction
                          ? 'bg-zinc-900 text-white hover:bg-zinc-800'
                          : isActive
                            ? 'bg-zinc-900 text-white'
                            : 'border border-zinc-200 text-zinc-700 hover:bg-zinc-100'
                      }`}
                    >
                      <Icon size={15} aria-hidden="true" />
                      <span className="hidden sm:inline">{label}</span>
                      <NavigationLinkStatus href={href} />
                    </Link>
                  )
                })}
              </nav>
            )}
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <div className="min-w-0 text-right">
              <div className="max-w-32 truncate text-xs text-zinc-500 sm:max-w-40 sm:text-sm">{adminName}</div>
              <div className="text-[10px] text-zinc-400">{memberKind === 'SHOP_OWNER' ? "Do'kon egasi" : 'Xodim'}</div>
            </div>
            <div className="w-8 h-8 rounded-full bg-zinc-900 text-white text-xs flex items-center justify-center font-medium shadow-sm">
              {initials(adminName)}
            </div>
            <SessionControls
              callbackUrl="/shop/login"
              idleTimeoutMs={sessionPolicy === 'IDLE_10_MINUTES' ? 10 * 60 * 1000 : null}
            />
          </div>
        </header>

        {canSeeReceivables && <DueOverdueBanner initialData={initialDueSummary} />}

        <main className="min-w-0 flex-1 overflow-auto bg-zinc-50">{children}</main>
      </div>
      </div>
    </ShopAccessProvider>
  )
}
