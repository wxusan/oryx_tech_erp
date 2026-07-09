'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Smartphone, CreditCard, Plus, BarChart3, Users, ScrollText, Settings } from 'lucide-react'
import { SessionControls } from '@/components/auth/session-controls'
import { Badge } from '@/components/ui/badge'
import { DueOverdueBanner } from '@/components/shop/due-overdue-banner'

const navLinks = [
  { href: '/shop/dashboard', label: 'Boshqaruv', icon: LayoutDashboard },
  { href: '/shop/qurilmalar', label: 'Qurilmalar', icon: Smartphone },
  { href: '/shop/mijozlar', label: 'Mijozlar', icon: Users },
  { href: '/shop/nasiyalar', label: 'Nasiyalar', icon: CreditCard },
  { href: '/shop/yangi-operatsiya', label: 'Yangi operatsiya', icon: Plus },
  { href: '/shop/hisobot', label: 'Hisobot', icon: BarChart3 },
  { href: '/shop/logs', label: 'Loglar', icon: ScrollText },
  { href: '/shop/settings', label: 'Sozlamalar', icon: Settings },
]

export default function ShopLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  return (
    <div className="flex min-h-screen flex-col bg-zinc-50 md:h-screen md:flex-row md:overflow-hidden">
      {/* Sidebar */}
      <aside className="flex w-full flex-shrink-0 flex-col border-b border-zinc-200 bg-white/95 md:w-64 md:border-b-0 md:border-r">
        {/* Logo area */}
        <div className="px-4 py-5 border-b border-zinc-200">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="font-bold text-lg text-zinc-900 leading-none">Oryx ERP</div>
              <div className="text-xs text-zinc-500 mt-1">Do&apos;kon portali</div>
            </div>
            <Badge variant="secondary" className="rounded-md">Faol</Badge>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex gap-1 overflow-x-auto px-2 py-3 md:block md:flex-1 md:space-y-0.5">
          {navLinks.map(({ href, label, icon: Icon }) => {
            const isActive = pathname === href || pathname.startsWith(href + '/')
            return (
              <Link
                key={href}
                href={href}
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

        {/* Bottom filler */}
        <div className="p-4 border-t border-zinc-200">
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
            <div className="text-xs font-medium text-zinc-900">Malika shop OS</div>
            <div className="mt-1 text-xs text-zinc-500">Ombor, nasiya, hisobot</div>
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col md:overflow-hidden">
        {/* Top bar */}
        <header className="h-14 border-b border-zinc-200 flex items-center justify-between px-6 bg-white/90 backdrop-blur flex-shrink-0">
          <span className="font-medium text-sm text-zinc-900">Do&apos;kon portali</span>
          <div className="flex items-center gap-2">
            <span className="text-sm text-zinc-500">Do'kon admini</span>
            <div className="w-8 h-8 rounded-full bg-zinc-900 text-white text-xs flex items-center justify-center font-medium shadow-sm">
              S
            </div>
            <SessionControls callbackUrl="/shop/login" />
          </div>
        </header>

        <DueOverdueBanner />

        {/* Content */}
        <main className="flex-1 overflow-auto bg-zinc-50">
          {children}
        </main>
      </div>
    </div>
  )
}
