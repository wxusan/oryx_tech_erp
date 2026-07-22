'use client'

import Link from 'next/link'
import { Smartphone, ShoppingCart, CreditCard, HandCoins, Repeat } from 'lucide-react'
import { useShopAccess } from '@/components/shop/shop-access-context'
import type { ShopPermissionCode } from '@/lib/access-control'

const operations = [
  {
    href: '/shop/qurilmalar/new?from=yangi-operatsiya',
    icon: Smartphone,
    title: "Yangi qurilma qo'shish",
    description: "Yangi kelgan qurilmani omborga kiriting yoki keyin to‘lashga oling",
    permissions: ['DEVICE_CREATE', 'DEVICE_PURCHASE_ON_CREDIT'],
  },
  {
    href: '/shop/sotuv/new',
    icon: ShoppingCart,
    title: 'Naqd sotuv',
    description: "Mavjud qurilmani naqd pul evaziga soting",
    permissions: ['SALE_CREATE'],
  },
  {
    href: '/shop/nasiyalar/new',
    icon: CreditCard,
    title: 'Nasiya sotuv',
    description: "Qurilmani nasiya asosida bering",
    permissions: ['NASIYA_CREATE'],
  },
  {
    href: '/shop/tolovlar',
    icon: HandCoins,
    title: "To'lov qabul qilish",
    description: "Nasiya yoki qarz sotuv to'lovini qabul qiling",
    permissions: ['NASIYA_PAYMENT_RECEIVE', 'SALE_PAYMENT_RECEIVE'],
  },
  {
    href: '/shop/olib-sotdim/new',
    icon: Repeat,
    title: 'Olib-sotdim',
    description: "Omborda yo'q qurilmani boshqa do'kondan olib, mijozga sotish",
    permissions: ['OLIB_CREATE'],
  },
] satisfies Array<{
  href: string
  icon: typeof Smartphone
  title: string
  description: string
  permissions: readonly ShopPermissionCode[]
}>

export default function YangiOperatsiyaPage() {
  const { can } = useShopAccess()
  const visibleOperations = operations.filter((operation) => operation.permissions.some((permission) => can(permission)))

  return (
    <div className="flex min-h-full flex-col items-center justify-center p-6">
      <div className="w-full max-w-5xl">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-zinc-900">Yangi operatsiya</h1>
          <p className="text-sm text-zinc-500 mt-1.5">Quyidagi amallardan birini tanlang</p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {visibleOperations.map(({ href, icon: Icon, title, description }) => (
            <Link key={`${href}:${title}`} href={href} className="group block h-52">
              <div className="grid h-full grid-rows-[3rem_2.5rem_1fr] place-items-center rounded border border-zinc-200 p-6 text-center transition-colors hover:bg-zinc-900 hover:text-white">
                <div className="flex h-12 items-center justify-center">
                  <Icon
                    size={48}
                    className="text-zinc-400 group-hover:text-zinc-200 transition-colors"
                  />
                </div>
                <div className="flex min-h-10 items-center justify-center font-semibold text-sm leading-5 text-zinc-900 transition-colors group-hover:text-white">
                  {title}
                </div>
                <div className="text-xs leading-relaxed text-zinc-500 transition-colors group-hover:text-zinc-300">
                  {description}
                </div>
              </div>
            </Link>
          ))}
        </div>
        {visibleOperations.length === 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-center text-sm text-amber-800">
            Sizga yangi operatsiya yaratish ruxsati berilmagan.
          </div>
        )}
      </div>
    </div>
  )
}
