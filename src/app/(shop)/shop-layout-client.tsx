'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Smartphone, CreditCard, Plus, BarChart3, Users, ScrollText, Settings } from 'lucide-react'
import { SessionControls } from '@/components/auth/session-controls'
import { Badge } from '@/components/ui/badge'
import { DueOverdueBanner } from '@/components/shop/due-overdue-banner'

const navLinks = [
  { href: '/shop/dashboard', label: 'Boshqaruv', icon: LayoutDashboard, prefetch: true },
  { href: '/shop/qurilmalar', label: 'Qurilmalar', icon: Smartphone, prefetch: true },
  { href: '/shop/mijozlar', label: 'Mijozlar', icon: Users, prefetch: false },
  { href: '/shop/nasiyalar', label: 'Nasiyalar', icon: CreditCard, prefetch: true },
  { href: '/shop/yangi-operatsiya', label: 'Yangi operatsiya', icon: Plus, prefetch: false },
  { href: '/shop/hisobot', label: 'Hisobot', icon: BarChart3, prefetch: false },
  { href: '/shop/logs', label: 'Loglar', icon: ScrollText, prefetch: false },
  { href: '/shop/settings', label: 'Sozlamalar', icon: Settings, prefetch: false },
]

function initials(name: string) {
  return name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'DA'
}

export function ShopLayoutClient({ children, shopName, adminName }: { children: React.ReactNode; shopName: string; adminName: string }) {
  const pathname = usePathname()

  return (
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
          {navLinks.map(({ href, label, icon: Icon, prefetch }) => {
            const isActive = pathname === href || pathname.startsWith(href + '/')
            return (
              <Link
                key={href}
                href={href}
                prefetch={prefetch}
                className={`flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                  isActive
                    ? 'bg-zinc-900 font-medium text-white shadow-sm'
                    : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900'
                }`}
              >
                <Icon size={16} className="flex-shrink-0" />
                {label}
              </Link>
            )
          })}
        </nav>

        <div className="p-4 border-t border-zinc-200">
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
            <div className="truncate text-xs font-medium text-zinc-900">{shopName}</div>
            <div className="mt-1 text-xs text-zinc-500">Ombor, nasiya, hisobot</div>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col md:overflow-hidden">
        <header className="flex h-14 flex-shrink-0 items-center justify-end gap-2 border-b border-zinc-200 bg-white/90 px-4 backdrop-blur sm:justify-between sm:px-6">
          <span className="hidden text-sm font-medium text-zinc-900 sm:inline">Do&apos;kon portali</span>
          <div className="flex min-w-0 items-center gap-2">
            <span className="max-w-32 truncate text-xs text-zinc-500 sm:max-w-40 sm:text-sm">{adminName}</span>
            <div className="w-8 h-8 rounded-full bg-zinc-900 text-white text-xs flex items-center justify-center font-medium shadow-sm">
              {initials(adminName)}
            </div>
            <SessionControls callbackUrl="/shop/login" idleTimeoutMs={null} />
          </div>
        </header>

        <DueOverdueBanner />

        <main className="min-w-0 flex-1 overflow-auto bg-zinc-50">{children}</main>
      </div>
    </div>
  )
}
