'use client'

import { useEffect, useMemo, useState } from 'react'
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

interface AdminStats {
  thisMonthRevenue: number
  totalRevenue: number
  totalPayments: number
  expectedRevenue: number
  totalShops: number
  activeShops: number
  suspendedShops: number
  dueSoon: number
  overdue: number
  shops: Array<{
    id: string
    name: string
    ownerName: string
    shopNumber: string
    status: 'ACTIVE' | 'SUSPENDED' | 'DELETED'
    subscriptionDue: string
    payments: Array<{
      amount: string | number
      months: number
      paidAt: string
    }>
    _count: {
      devices: number
      nasiya: number
    }
  }>
}

function formatMoney(value: number) {
  return value.toLocaleString('ru-RU') + " so'm"
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString('uz-UZ', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function daysUntil(value: string) {
  const now = new Date()
  const due = new Date(value)
  return Math.ceil((due.getTime() - now.getTime()) / (24 * 60 * 60 * 1000))
}

export default function AdminReportsPage() {
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/stats/admin')
      .then(async (response) => {
        const json: ApiResponse<AdminStats> = await response.json()
        if (!response.ok || !json.success) throw new Error(json.error || 'Hisobot yuklanmadi')
        setStats(json.data ?? null)
      })
      .catch((err: Error) => setError(err.message || 'Hisobot yuklanmadi'))
      .finally(() => setLoading(false))
  }, [])

  const collectionRate = stats?.expectedRevenue
    ? Math.min(100, Math.round((stats.thisMonthRevenue / stats.expectedRevenue) * 100))
    : 0
  const averagePayment = stats?.totalPayments ? Math.round(stats.totalRevenue / stats.totalPayments) : 0
  const dueRows = useMemo(
    () => (stats?.shops ?? []).filter((shop) => shop.status === 'ACTIVE').slice(0, 12),
    [stats],
  )

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
                {loading ? 'Yuklanmoqda...' : formatMoney(stats?.thisMonthRevenue ?? 0)}
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-zinc-500">
                <span>Kutilayotgan tushumga nisbatan</span>
                <span className="font-semibold text-zinc-800">{collectionRate}%</span>
              </div>
              <Progress value={collectionRate} />
              <div className="flex items-center justify-between text-xs text-zinc-500">
                <span>Kutilayotgan: {formatMoney(stats?.expectedRevenue ?? 0)}</span>
                <span>Faol: {stats?.activeShops ?? 0}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:col-span-7">
          <MetricCard icon={ReceiptText} label="Jami tushum" value={formatMoney(stats?.totalRevenue ?? 0)} />
          <MetricCard icon={Building2} label="Jami do'konlar" value={String(stats?.totalShops ?? 0)} />
          <MetricCard icon={Percent} label="O'rtacha to'lov" value={formatMoney(averagePayment)} />
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
              {loading ? (
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
                        <Link href={`/admin/shops/${shop.id}`} prefetch={false} className="hover:underline">
                          {shop.name} <span className="text-xs text-zinc-400">#{shop.shopNumber}</span>
                        </Link>
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
