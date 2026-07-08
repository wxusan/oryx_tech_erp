'use client'

import Link from 'next/link'
import { Smartphone, ShoppingCart, CreditCard, HandCoins, Repeat } from 'lucide-react'

const operations = [
  {
    href: '/shop/qurilmalar/new',
    icon: Smartphone,
    title: "Yangi qurilma qo'shish",
    description: "Yangi kelgan qurilmani omborga kiriting",
  },
  {
    href: '/shop/sotuv/new',
    icon: ShoppingCart,
    title: 'Naqd sotuv',
    description: "Mavjud qurilmani naqd pul evaziga soting",
  },
  {
    href: '/shop/nasiyalar/new',
    icon: CreditCard,
    title: 'Nasiya sotuv',
    description: "Qurilmani nasiya asosida bering",
  },
  {
    href: '/shop/nasiyalar',
    icon: HandCoins,
    title: "To'lov qabul qilish",
    description: "Mijoz nasiyasini tanlab, oylik to'lovni kiriting",
  },
  {
    href: '/shop/olib-sotdim/new',
    icon: Repeat,
    title: 'Olib-sotdim',
    description: "Omborda yo'q qurilmani boshqa do'kondan olib, mijozga sotish",
  },
]

export default function YangiOperatsiyaPage() {
  return (
    <div className="p-6 flex flex-col items-center justify-center min-h-[calc(100vh-3rem)]">
      <div className="w-full max-w-5xl">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-zinc-900">Yangi operatsiya</h1>
          <p className="text-sm text-zinc-500 mt-1.5">Quyidagi amallardan birini tanlang</p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {operations.map(({ href, icon: Icon, title, description }) => (
            <Link key={href} href={href} className="block group">
              <div className="p-8 border border-zinc-200 rounded cursor-pointer hover:bg-zinc-900 hover:text-white transition-colors text-center group">
                <div className="flex justify-center mb-4">
                  <Icon
                    size={48}
                    className="text-zinc-400 group-hover:text-zinc-200 transition-colors"
                  />
                </div>
                <div className="font-semibold text-sm text-zinc-900 group-hover:text-white transition-colors mb-1.5">
                  {title}
                </div>
                <div className="text-xs text-zinc-500 group-hover:text-zinc-300 transition-colors leading-relaxed">
                  {description}
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
