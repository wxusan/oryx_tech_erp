'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

type ShopStatus = 'ACTIVE' | 'SUSPENDED' | 'DELETED'
type FilterTab = 'barchasi' | ShopStatus

interface Shop {
  id: string
  name: string
  ownerName: string
  ownerPhone: string
  shopNumber: string
  status: ShopStatus
  subscriptionDue: string
}

const tabs: { key: FilterTab; label: string }[] = [
  { key: 'barchasi', label: 'Barchasi' },
  { key: 'ACTIVE', label: 'Faol' },
  { key: 'SUSPENDED', label: "To'xtatilgan" },
  { key: 'DELETED', label: "O'chirilgan" },
]

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

export default function ShopsPage() {
  const [shops, setShops] = useState<Shop[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [activeTab, setActiveTab] = useState<FilterTab>('barchasi')

  useEffect(() => {
    fetch('/api/shops?includeDeleted=true')
      .then((r) => r.json())
      .then((json) => {
        if (json.success) setShops(json.data)
        else setError(json.error ?? "Do'konlar yuklanmadi")
      })
      .catch(() => setError('Xatolik yuz berdi'))
      .finally(() => setLoading(false))
  }, [])

  const filtered = shops.filter((s) => {
    const matchTab = activeTab === 'barchasi' || s.status === activeTab
    const q = search.toLowerCase()
    const matchSearch =
      !q ||
      s.name.toLowerCase().includes(q) ||
      s.ownerName.toLowerCase().includes(q) ||
      s.ownerPhone.includes(q) ||
      s.shopNumber.includes(q)
    return matchTab && matchSearch
  })

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-zinc-900">Do&apos;konlar</h1>
        <Link href="/admin/shops/new">
          <Button className="bg-zinc-900 text-white hover:bg-zinc-700 h-8 px-3 text-sm rounded-none">
            + Yangi do&apos;kon
          </Button>
        </Link>
      </div>

      {error && (
        <div className="mb-4 p-3 border border-red-200 bg-red-50 text-sm text-red-600">
          {error}
        </div>
      )}

      {/* Search + Tabs */}
      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <Input
          placeholder="Do'kon nomi, egasi, tel bo'yicha..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 text-sm max-w-xs rounded-none border-zinc-200"
        />
        <div className="flex items-center gap-0 border border-zinc-200">
          {tabs.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={[
                'px-3 py-1.5 text-xs font-medium transition-colors border-r border-zinc-200 last:border-r-0',
                activeTab === key
                  ? 'bg-zinc-900 text-white'
                  : 'bg-white text-zinc-500 hover:bg-zinc-50 hover:text-zinc-800',
              ].join(' ')}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-zinc-200">
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
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-10 text-sm text-zinc-400">
                  Hech qanday do&apos;kon topilmadi
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((shop) => (
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
