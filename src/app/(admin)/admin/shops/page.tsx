'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatUzPhoneDisplay } from '@/lib/phone'
import { StretchedLink } from '@/components/ui/stretched-link'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { queryKeys } from '@/lib/query-keys'
import { useAuthenticatedQueryScope } from '@/components/query-scope-context'
import { ShopStatusBadge } from '@/components/admin/shop-status-badge'
import type { ShopStatus } from '@/lib/domain-types'

type FilterTab = 'barchasi' | ShopStatus
type PaymentView = 'all' | 'overdue'

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

function dueDateSortValue(value: string) {
  if (!value) return Number.POSITIVE_INFINITY
  const time = new Date(value).getTime()
  return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY
}

function formatDate(value: string) {
  return value ? new Date(value).toLocaleDateString('ru-RU') : '—'
}

function isOverdueShop(shop: Shop) {
  return shop.status === 'ACTIVE' && dueDateSortValue(shop.subscriptionDue) < Date.now()
}

function subscribeToLocation() {
  return () => {}
}

function getPaymentViewSnapshot(): PaymentView {
  if (typeof window === 'undefined') return 'all'
  const params = new URLSearchParams(window.location.search)
  return params.get('payment') === 'overdue' ? 'overdue' : 'all'
}

export default function ShopsPage() {
  const scope = useAuthenticatedQueryScope()
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [activeTab, setActiveTab] = useState<FilterTab>('barchasi')
  const paymentView = useSyncExternalStore(
    subscribeToLocation,
    getPaymentViewSnapshot,
    () => 'all',
  )

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => window.clearTimeout(timeout)
  }, [search])

  const shopsQuery = useQuery({
    queryKey: queryKeys.list(scope, 'adminShops', { search: debouncedSearch, status: activeTab }),
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ includeDeleted: 'true', take: '500' })
      if (debouncedSearch) params.set('search', debouncedSearch)
      if (activeTab !== 'barchasi') params.set('status', activeTab)
      const response = await fetch(`/api/shops?${params.toString()}`, { signal, cache: 'no-store' })
      const json = await response.json() as { success: boolean; data?: Shop[]; error?: string }
      if (!response.ok || !json.success || !json.data) throw new Error(json.error ?? "Do'konlar yuklanmadi")
      return json.data
    },
    placeholderData: keepPreviousData,
  })
  const shops = shopsQuery.data ?? []
  const loading = shopsQuery.isPending && !shopsQuery.data
  const error = shopsQuery.error instanceof Error ? shopsQuery.error.message : null

  const filtered = shops
    .filter((s) => {
      const matchTab = activeTab === 'barchasi' || s.status === activeTab
      const q = debouncedSearch.toLowerCase()
      const matchSearch =
        !q ||
        s.name.toLowerCase().includes(q) ||
        s.ownerName.toLowerCase().includes(q) ||
        s.ownerPhone.includes(q) ||
        s.shopNumber.includes(q)
      return matchTab && matchSearch
    })
    .sort((a, b) => {
      if (paymentView === 'overdue') {
        const overdueA = isOverdueShop(a)
        const overdueB = isOverdueShop(b)
        if (overdueA !== overdueB) return overdueA ? -1 : 1
      }
      return dueDateSortValue(a.subscriptionDue) - dueDateSortValue(b.subscriptionDue)
    })

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-zinc-900">Do&apos;konlar</h1>
        <Button render={<Link href="/admin/shops/new" />} nativeButton={false} size="lg">
          + Yangi do&apos;kon
        </Button>
      </div>

      {error && (
        <div className="mb-4 p-3 border border-red-200 bg-red-50 text-sm text-red-600">
          {error}
        </div>
      )}

      {/* Search + Tabs */}
      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <Input
          aria-label="Do'konlarni qidirish"
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
              <TableHead className="text-xs text-zinc-500 font-medium">Keyingi to&apos;lov sanasi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-10 text-sm text-zinc-400">
                  Yuklanmoqda...
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-10 text-sm text-zinc-400">
                  Hech qanday do&apos;kon topilmadi
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((shop) => {
                const overdue = isOverdueShop(shop)
                return (
                  <TableRow key={shop.id} className="relative border-zinc-100 hover:bg-zinc-50">
                    <TableCell className="pl-5 text-sm font-medium text-zinc-900">
                      <StretchedLink
                        href={`/admin/shops/${shop.id}`}
                        aria-label={`${shop.name} do'koni ma'lumotlarini ochish`}
                        className="font-medium text-zinc-900 hover:underline"
                      >
                        {shop.name}
                      </StretchedLink>
                    </TableCell>
                    <TableCell className="text-sm text-zinc-600">{shop.ownerName}</TableCell>
                    <TableCell className="text-sm text-zinc-500 font-mono">{formatUzPhoneDisplay(shop.ownerPhone)}</TableCell>
                    <TableCell className="text-sm text-zinc-500">{shop.shopNumber}</TableCell>
                    <TableCell>
                      <ShopStatusBadge status={shop.status} />
                    </TableCell>
                    <TableCell className={overdue ? 'text-sm font-medium text-red-700' : 'text-sm text-zinc-500'}>
                      {formatDate(shop.subscriptionDue)}
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
