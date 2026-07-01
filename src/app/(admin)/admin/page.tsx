'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

type ShopStatus = 'ACTIVE' | 'SUSPENDED' | 'DELETED'

interface ShopRow {
  id: string
  name: string
  ownerName: string
  ownerPhone: string
  shopNumber: string
  status: ShopStatus
  subscriptionDue: string
}

interface AdminStats {
  thisMonthRevenue: number
  expectedRevenue: number
  activeShops: number
  dueSoon: number
  overdue: number
}

function formatMoney(n: number) {
  return n.toLocaleString('ru-RU') + " so'm"
}

function StatusBadge({ status }: { status: ShopStatus }) {
  if (status === 'ACTIVE') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium bg-zinc-900 text-white">
        Faol
      </span>
    )
  }
  if (status === 'SUSPENDED') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium bg-zinc-100 text-zinc-500">
        To&apos;xtatilgan
      </span>
    )
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium bg-zinc-100 text-zinc-400">
      O&apos;chirilgan
    </span>
  )
}

export default function DashboardPage() {
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [shops, setShops] = useState<ShopRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      fetch('/api/stats/admin').then((r) => r.json()),
      fetch('/api/shops').then((r) => r.json()),
    ])
      .then(([statsJson, shopsJson]) => {
        if (statsJson.success) setStats(statsJson.data)
        else setError(statsJson.error ?? 'Statistika yuklanmadi')

        if (shopsJson.success) {
          const sorted = [...shopsJson.data].sort(
            (a: ShopRow, b: ShopRow) =>
              new Date(a.subscriptionDue).getTime() - new Date(b.subscriptionDue).getTime()
          )
          setShops(sorted)
        } else {
          setError(shopsJson.error ?? "Do'konlar yuklanmadi")
        }
      })
      .catch(() => setError('Xatolik yuz berdi'))
      .finally(() => setLoading(false))
  }, [])

  const statCards = [
    { label: "Bu oy tushum", value: stats ? formatMoney(stats.thisMonthRevenue) : 'Yuklanmoqda...' },
    { label: "Kutilayotgan to'lovlar", value: stats ? formatMoney(stats.expectedRevenue) : 'Yuklanmoqda...' },
    { label: "Faol do'konlar", value: stats ? String(stats.activeShops) : 'Yuklanmoqda...' },
    { label: "Muddati o'tgan", value: stats ? String(stats.overdue) : 'Yuklanmoqda...' },
    { label: "Muddati yaqin", value: stats ? String(stats.dueSoon) : 'Yuklanmoqda...' },
  ]

  return (
    <div className="max-w-6xl mx-auto">
      <h1 className="text-xl font-semibold text-zinc-900 mb-6">Boshqaruv paneli</h1>

      {error && (
        <div className="mb-4 p-3 border border-red-200 bg-red-50 text-sm text-red-600">
          {error}
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
        {statCards.map(({ label, value }) => (
          <div
            key={label}
            className="bg-white border border-zinc-200 p-4"
          >
            <div className="text-xs text-zinc-500 mb-2">{label}</div>
            <div className="text-2xl font-bold text-zinc-900">{value}</div>
          </div>
        ))}
      </div>

      {/* Shops table */}
      <div className="bg-white border border-zinc-200">
        <div className="px-5 py-4 border-b border-zinc-200 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-900">Do&apos;konlar ro&apos;yxati</h2>
          <Link
            href="/admin/shops"
            className="text-xs text-zinc-400 hover:text-zinc-700 transition-colors"
          >
            Barchasini ko&apos;rish →
          </Link>
        </div>
        <Table>
          <TableHeader>
            <TableRow className="border-zinc-200 bg-zinc-50">
              <TableHead className="text-xs text-zinc-500 font-medium pl-5">Do&apos;kon nomi</TableHead>
              <TableHead className="text-xs text-zinc-500 font-medium">Egalik qiluvchi</TableHead>
              <TableHead className="text-xs text-zinc-500 font-medium">Tel</TableHead>
              <TableHead className="text-xs text-zinc-500 font-medium">Do&apos;kon raqami</TableHead>
              <TableHead className="text-xs text-zinc-500 font-medium">Status</TableHead>
              <TableHead className="text-xs text-zinc-500 font-medium">To&apos;lov sanasi</TableHead>
              <TableHead className="text-xs text-zinc-500 font-medium pr-5 text-right">Amallar</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-10 text-sm text-zinc-400">
                  Yuklanmoqda...
                </TableCell>
              </TableRow>
            ) : shops.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-10 text-sm text-zinc-400">
                  Hech qanday do&apos;kon topilmadi
                </TableCell>
              </TableRow>
            ) : (
              shops.map((shop) => (
                <TableRow key={shop.id} className="border-zinc-100 hover:bg-zinc-50">
                  <TableCell className="pl-5 text-sm font-medium text-zinc-900">{shop.name}</TableCell>
                  <TableCell className="text-sm text-zinc-600">{shop.ownerName}</TableCell>
                  <TableCell className="text-sm text-zinc-500 font-mono">{shop.ownerPhone}</TableCell>
                  <TableCell className="text-sm text-zinc-500">{shop.shopNumber}</TableCell>
                  <TableCell>
                    <StatusBadge status={shop.status} />
                  </TableCell>
                  <TableCell className="text-sm text-zinc-500">
                    {shop.subscriptionDue ? new Date(shop.subscriptionDue).toLocaleDateString('ru-RU') : '—'}
                  </TableCell>
                  <TableCell className="pr-5 text-right">
                    <Link
                      href={`/admin/shops/${shop.id}`}
                      className="text-xs text-zinc-500 hover:text-zinc-900 border border-zinc-200 px-2.5 py-1 hover:bg-zinc-50 transition-colors"
                    >
                      Ko&apos;rish
                    </Link>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
