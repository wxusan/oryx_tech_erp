'use client'

import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { AlertTriangle, Building2, CalendarClock, CreditCard, Percent, ReceiptText } from 'lucide-react'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { ApiResponse } from '@/types'
import { uzLongDate } from '@/lib/dates'
import { IntentPrefetchLink } from '@/components/intent-prefetch-link'
import { queryKeys } from '@/lib/query-keys'
import { useAuthenticatedQueryScope } from '@/components/query-scope-context'
import { useAdminCurrency } from '@/lib/use-admin-currency'
import {
  expectedAdminMoneyValue,
  formatExpectedAdminMoney,
  formatHistoricalAdminMoney,
  historicalAdminMoneyValue,
  type HistoricalAdminMoney,
  type NativeAdminMoney,
} from '@/lib/admin-money'

interface AdminStats {
  thisMonthRevenue: HistoricalAdminMoney
  totalRevenue: HistoricalAdminMoney
  totalPayments: number
  expectedRevenue: NativeAdminMoney
  totalShops: number
  activeShops: number
  suspendedShops: number
  dueSoon: number
  overdue: number
}

interface DueShop {
  id: string
  name: string
  ownerName: string
  shopNumber: string
  subscriptionDue: string
  _count: {
    devices: number
    nasiya: number
  }
}

interface DueShopsPage {
  items: DueShop[]
  total: number
  skip: number
  take: number
}

function formatDate(value: string) {
  return uzLongDate(value)
}

function daysUntil(value: string) {
  const now = new Date()
  const due = new Date(value)
  return Math.ceil((due.getTime() - now.getTime()) / (24 * 60 * 60 * 1000))
}

export default function AdminReportsPage() {
  const scope = useAuthenticatedQueryScope()
  const { currency } = useAdminCurrency()
  const [duePage, setDuePage] = useState(1)
  const duePerPage = 12
  const statsQuery = useQuery({
    queryKey: queryKeys.list(scope, 'adminReports', { view: 'report' }),
    queryFn: async ({ signal }) => {
      const response = await fetch('/api/stats/admin', { signal, cache: 'no-store' })
      const json: ApiResponse<AdminStats> = await response.json()
      if (!response.ok || !json.success || !json.data) throw new Error(json.error || 'Hisobot yuklanmadi')
      return json.data
    },
  })
  const dueShopsQuery = useQuery({
    queryKey: queryKeys.list(scope, 'adminReports', { view: 'dueShops', page: duePage, take: duePerPage }),
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({
        skip: String((duePage - 1) * duePerPage),
        take: String(duePerPage),
      })
      const response = await fetch(`/api/admin/reports/due-shops?${params.toString()}`, { signal, cache: 'no-store' })
      const json: ApiResponse<DueShopsPage> = await response.json()
      if (!response.ok || !json.success || !json.data) throw new Error(json.error || "Do'konlar yuklanmadi")
      return json.data
    },
    placeholderData: keepPreviousData,
  })
  const stats = statsQuery.data ?? null
  const statsLoading = statsQuery.isPending && !statsQuery.data
  const dueLoading = dueShopsQuery.isPending && !dueShopsQuery.data
  const error = statsQuery.error instanceof Error
    ? statsQuery.error.message
    : dueShopsQuery.error instanceof Error
      ? dueShopsQuery.error.message
      : ''

  const receivedValue = stats ? historicalAdminMoneyValue(stats.thisMonthRevenue, currency.currency) : null
  const expectedValue = stats ? expectedAdminMoneyValue(stats.expectedRevenue, currency) : null
  const totalRevenueValue = stats ? historicalAdminMoneyValue(stats.totalRevenue, currency.currency) : null
  const collectionRate = receivedValue !== null && expectedValue !== null && expectedValue > 0
    ? Math.min(100, Math.round((receivedValue / expectedValue) * 100))
    : 0
  const averagePayment = stats?.totalPayments && totalRevenueValue !== null
    ? totalRevenueValue / stats.totalPayments
    : null
  const dueRows = dueShopsQuery.data?.items ?? []
  const dueTotal = dueShopsQuery.data?.total ?? 0
  const dueTotalPages = Math.max(1, Math.ceil(dueTotal / duePerPage))

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-zinc-900">Hisobot</h1>
          <p className="mt-0.5 text-sm text-zinc-500">Bosh admin uchun obuna tushumi va do'konlar holati</p>
        </div>
        <Link href="/admin/payments" className="text-sm font-medium text-zinc-500 hover:text-zinc-900">
          To'lovlar tarixi
        </Link>
      </div>

      {error && (
        <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <Card className="rounded-lg lg:col-span-5">
          <CardHeader className="border-b border-zinc-100">
            <CardTitle>Bu oy tushumi</CardTitle>
            <CardDescription>Shop obunalaridan yig'ilgan pul</CardDescription>
            <CardAction>
              <CreditCard className="size-5 text-zinc-400" />
            </CardAction>
          </CardHeader>
          <CardContent className="space-y-5">
            <div>
              <div className="text-xs font-medium uppercase text-zinc-500">Tushgan summa</div>
              <div className="mt-1 text-3xl font-bold tracking-tight text-zinc-900">
                {statsLoading || !stats ? 'Yuklanmoqda...' : formatHistoricalAdminMoney(stats.thisMonthRevenue, currency)}
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-zinc-500">
                <span>Kutilayotgan tushumga nisbatan</span>
                <span className="font-semibold text-zinc-800">{collectionRate}%</span>
              </div>
              <Progress value={collectionRate} />
              <div className="flex items-center justify-between text-xs text-zinc-500">
                <span>Kutilayotgan: {stats ? formatExpectedAdminMoney(stats.expectedRevenue, currency) : '—'}</span>
                <span>Faol: {stats?.activeShops ?? 0}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:col-span-7">
          <MetricCard icon={ReceiptText} label="Jami tushum" value={stats ? formatHistoricalAdminMoney(stats.totalRevenue, currency) : '—'} />
          <MetricCard icon={Building2} label="Jami do'konlar" value={String(stats?.totalShops ?? 0)} />
          <MetricCard
            icon={Percent}
            label="O'rtacha to'lov"
            value={averagePayment === null
              ? 'Valyuta ma’lumoti to‘liq emas'
              : new Intl.NumberFormat(currency.currency === 'USD' ? 'en-US' : 'uz-UZ', {
                  style: 'currency',
                  currency: currency.currency,
                  maximumFractionDigits: currency.currency === 'USD' ? 2 : 0,
                }).format(averagePayment)}
          />
          <MetricCard icon={AlertTriangle} label="Muddati o'tgan" value={String(stats?.overdue ?? 0)} danger />
        </div>
      </div>

      <Card className="rounded-lg">
        <CardHeader className="border-b border-zinc-100">
          <CardTitle>To'lov muddati bo'yicha do'konlar</CardTitle>
          <CardDescription>Obuna muddati eng yaqin do'konlar tepada turadi</CardDescription>
          <CardAction>
            <CalendarClock className="size-5 text-zinc-400" />
          </CardAction>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-zinc-50">
                <TableHead className="pl-5">Do'kon</TableHead>
                <TableHead>Egasi</TableHead>
                <TableHead>Qurilmalar</TableHead>
                <TableHead>Nasiyalar</TableHead>
                <TableHead>To'lov sanasi</TableHead>
                <TableHead className="pr-5 text-right">Qolgan kun</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dueLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-sm text-zinc-400">
                    Yuklanmoqda...
                  </TableCell>
                </TableRow>
              ) : dueRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-sm text-zinc-400">
                    Faol do'konlar topilmadi
                  </TableCell>
                </TableRow>
              ) : (
                dueRows.map((shop) => {
                  const days = daysUntil(shop.subscriptionDue)
                  return (
                    <TableRow key={shop.id}>
                      <TableCell className="pl-5 font-medium text-zinc-900">
                        <IntentPrefetchLink href={`/admin/shops/${shop.id}`} className="hover:underline">
                          {shop.name} <span className="text-xs text-zinc-400">#{shop.shopNumber}</span>
                        </IntentPrefetchLink>
                      </TableCell>
                      <TableCell className="text-zinc-600">{shop.ownerName}</TableCell>
                      <TableCell className="text-zinc-600">{shop._count.devices}</TableCell>
                      <TableCell className="text-zinc-600">{shop._count.nasiya}</TableCell>
                      <TableCell className="text-zinc-600">{formatDate(shop.subscriptionDue)}</TableCell>
                      <TableCell className={['pr-5 text-right font-semibold', days < 0 ? 'text-red-700' : 'text-zinc-900'].join(' ')}>
                        {days < 0 ? `${Math.abs(days)} kun o'tgan` : `${days} kun`}
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
          <div className="flex flex-col gap-2 border-t border-zinc-100 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-xs text-zinc-400">
              {dueTotal} ta faol do&apos;kondan {dueTotal === 0 ? 0 : Math.min((duePage - 1) * duePerPage + 1, dueTotal)}-{Math.min(duePage * duePerPage, dueTotal)} ko&apos;rsatilmoqda
            </span>
            <div className="flex items-center border border-zinc-200">
              <button
                type="button"
                onClick={() => setDuePage((page) => Math.max(1, page - 1))}
                disabled={duePage === 1 || dueShopsQuery.isFetching}
                className="h-8 border-r border-zinc-200 px-4 text-xs text-zinc-600 transition-colors hover:bg-zinc-50 disabled:pointer-events-none disabled:opacity-40"
              >
                Oldingi
              </button>
              <span className="flex h-8 items-center px-4 text-xs text-zinc-500">
                {duePage} / {dueTotalPages}
              </span>
              <button
                type="button"
                onClick={() => setDuePage((page) => Math.min(dueTotalPages, page + 1))}
                disabled={duePage === dueTotalPages || dueShopsQuery.isFetching}
                className="h-8 border-l border-zinc-200 px-4 text-xs text-zinc-600 transition-colors hover:bg-zinc-50 disabled:pointer-events-none disabled:opacity-40"
              >
                Keyingi
              </button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function MetricCard({
  icon: Icon,
  label,
  value,
  danger = false,
}: {
  icon: typeof ReceiptText
  label: string
  value: string
  danger?: boolean
}) {
  return (
    <Card className={['rounded-lg', danger ? 'border-red-200 bg-red-50/40' : ''].join(' ')}>
      <CardHeader>
        <CardDescription className={danger ? 'text-red-700' : undefined}>{label}</CardDescription>
        <CardAction>
          <Icon className={['size-4', danger ? 'text-red-500' : 'text-zinc-400'].join(' ')} />
        </CardAction>
      </CardHeader>
      <CardContent>
        <div className={['text-2xl font-bold', danger ? 'text-red-700' : 'text-zinc-900'].join(' ')}>{value}</div>
      </CardContent>
    </Card>
  )
}
