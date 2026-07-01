'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Store, CreditCard, ScrollText, Settings } from 'lucide-react'

const navItems = [
  { label: "Boshqaruv", href: "/admin", icon: LayoutDashboard },
  { label: "Do'konlar", href: "/admin/shops", icon: Store },
  { label: "To'lovlar", href: "/admin/payments", icon: CreditCard },
  { label: "Loglar", href: "/admin/logs", icon: ScrollText },
  { label: "Sozlamalar", href: "/admin/settings", icon: Settings },
]

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  return (
    <div className="flex min-h-screen flex-col bg-white md:h-screen md:flex-row md:overflow-hidden">
      {/* Sidebar */}
      <aside className="flex w-full shrink-0 flex-col border-b border-zinc-200 bg-white md:w-60 md:border-b-0 md:border-r">
        {/* Logo */}
        <div className="px-5 py-5 border-b border-zinc-200">
          <div className="font-bold text-zinc-900 text-sm leading-tight tracking-tight">Oryx ERP</div>
          <div className="text-xs text-zinc-400 mt-0.5">Admin panel</div>
        </div>

        {/* Nav */}
        <nav className="flex gap-1 overflow-x-auto px-3 py-3 md:block md:flex-1 md:space-y-0.5 md:overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon
            const isActive =
              pathname === item.href ||
              (item.href !== '/admin' && pathname.startsWith(item.href))
            return (
              <Link
                key={item.href}
                href={item.href}
                className={[
                  'flex shrink-0 items-center gap-2.5 px-3 py-2 text-sm transition-colors',
                  isActive
                    ? 'bg-zinc-900 text-white'
                    : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900',
                ].join(' ')}
              >
                <Icon size={15} strokeWidth={1.8} />
                <span>{item.label}</span>
              </Link>
            )
          })}
        </nav>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-zinc-200">
          <div className="text-xs text-zinc-400">Oryx Tech ERP v1.0</div>
        </div>
      </aside>

      {/* Right side */}
      <div className="flex min-w-0 flex-1 flex-col md:overflow-hidden">
        {/* Top bar */}
        <header className="h-12 shrink-0 flex items-center justify-end gap-3 px-6 border-b border-zinc-200 bg-white">
          <span className="text-xs text-zinc-500 font-medium">Super Admin</span>
          <div
            className="w-7 h-7 bg-zinc-900 text-white text-[11px] font-bold flex items-center justify-center select-none"
          >
            SA
          </div>
        </header>

        {/* Main content */}
        <main className="flex-1 overflow-y-auto bg-white p-4 md:p-8">
          {children}
        </main>
      </div>
    </div>
  )
}
