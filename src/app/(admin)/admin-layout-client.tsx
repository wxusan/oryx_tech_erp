'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Activity, BarChart3, LayoutDashboard, Store, CreditCard, ScrollText, Settings } from 'lucide-react'
import { SessionControls } from '@/components/auth/session-controls'
import { Badge } from '@/components/ui/badge'
import { NavigationCacheCoordinator } from '@/components/navigation-cache-coordinator'

const navItems = [
  { label: 'Boshqaruv', href: '/admin', icon: LayoutDashboard, prefetch: true },
  { label: "Do'konlar", href: '/admin/shops', icon: Store, prefetch: true },
  { label: "To'lovlar", href: '/admin/payments', icon: CreditCard, prefetch: false },
  { label: 'Hisobot', href: '/admin/hisobot', icon: BarChart3, prefetch: false },
  { label: 'Loglar', href: '/admin/logs', icon: ScrollText, prefetch: false },
  { label: 'Tizim', href: '/admin/ops', icon: Activity, prefetch: false },
  { label: 'Sozlamalar', href: '/admin/settings', icon: Settings, prefetch: false },
]

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return 'SA'
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')
}

export function AdminLayoutClient({ children, adminName, navigationScope }: { children: React.ReactNode; adminName: string; navigationScope: string }) {
  const pathname = usePathname()
  const displayName = adminName.trim() || 'Admin'

  return (
    <div className="flex min-h-screen flex-col bg-zinc-50 md:h-screen md:flex-row md:overflow-hidden">
      <NavigationCacheCoordinator scopeKey={navigationScope} />
      <aside className="flex w-full shrink-0 flex-col border-b border-zinc-200 bg-white/95 md:w-64 md:border-b-0 md:border-r">
        <div className="border-b border-zinc-200 px-5 py-5">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-sm font-bold leading-tight tracking-tight text-zinc-900">Oryx ERP</div>
              <div className="mt-0.5 text-xs text-zinc-500">Boshqaruv paneli</div>
            </div>
            <Badge variant="secondary" className="rounded-md">Platforma</Badge>
          </div>
        </div>

        <nav className="flex gap-1 overflow-x-auto px-3 py-3 md:block md:flex-1 md:space-y-0.5 md:overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon
            const isActive = pathname === item.href || (item.href !== '/admin' && pathname.startsWith(item.href))
            return (
              <Link
                key={item.href}
                href={item.href}
                prefetch={item.prefetch}
                className={[
                  'flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm transition-colors',
                  isActive
                    ? 'bg-zinc-900 text-white shadow-sm'
                    : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900',
                ].join(' ')}
              >
                <Icon size={15} strokeWidth={1.8} />
                <span>{item.label}</span>
              </Link>
            )
          })}
        </nav>

        <div className="border-t border-zinc-200 px-5 py-4">
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
            <div className="text-xs font-medium text-zinc-900">Platforma nazorati</div>
            <div className="mt-1 text-xs text-zinc-500">Do&apos;konlar, obuna, loglar</div>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col md:overflow-hidden">
        <header className="flex h-14 shrink-0 items-center justify-end gap-3 border-b border-zinc-200 bg-white/90 px-6 backdrop-blur">
          <span className="text-xs font-medium text-zinc-500">{displayName}</span>
          <div className="flex size-8 select-none items-center justify-center rounded-full bg-zinc-900 text-[11px] font-bold text-white shadow-sm">
            {initials(displayName)}
          </div>
          <SessionControls callbackUrl="/admin/login" />
        </header>

        <main className="flex-1 overflow-y-auto bg-zinc-50 p-4 md:p-8">{children}</main>
      </div>
    </div>
  )
}
