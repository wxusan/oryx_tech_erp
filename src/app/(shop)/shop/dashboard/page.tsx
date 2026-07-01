'use client'

import { useState, useEffect } from 'react'
import {
  AlertTriangle,
  Banknote,
  CalendarClock,
  ClipboardList,
  Package,
  ReceiptText,
  TrendingUp,
  WalletCards,
} from 'lucide-react'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'

interface UpcomingPayment {
  nasiya: {
    customer: { name: string }
    device: { model: string }
  }
  dueDate: string
  expectedAmount: number
  paidAmount: number
  status: string
}

interface RecentActivity {
  action: string
  createdAt: string
  actorId: string
}

interface ShopStats {
  totalDevices: number
  soldThisMonth: number
  activeNasiyalar: number
  expectedThisMonth: number
  overdueMoney: number
  inventoryPurchaseCost: number
  realProfitThisMonth: number
  accrualGrossProfitThisMonth: number
  cashCollectedThisMonth: number
  overdueCount: number
  upcomingPayments: UpcomingPayment[]
  recentActivity: RecentActivity[]
}

function fmt(n: number) {
  return `${Number(n).toLocaleString('ru-RU')} so'm`
}

function fmtSigned(n: number) {
  const sign = n > 0 ? '+' : ''
  return `${sign}${fmt(n)}`
}

function outstanding(payment: UpcomingPayment) {
  return Math.max(0, Number(payment.expectedAmount) - Number(payment.paidAmount ?? 0))
}

function statusLabel(status: string) {
  if (status === 'OVERDUE') return "Muddati o'tgan"
  if (status === 'PARTIAL') return "Qisman to'langan"
  if (status === 'DEFERRED') return "Kechiktirilgan"
  if (status === 'PAID') return "To'langan"
  return 'Kutilmoqda'
}

export default function DashboardPage() {
  const [stats, setStats] = useState<ShopStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/stats/shop')
      .then((r) => r.json())
      .then((json) => {
        if (json.success) setStats(json.data)
        else setError(json.error || 'Xatolik yuz berdi')
      })
      .catch(() => setError('Xatolik yuz berdi'))
      .finally(() => setLoading(false))
  }, [])

  const collectionBase = stats
    ? stats.cashCollectedThisMonth + stats.expectedThisMonth
    : 0
  const collectionRate = stats && collectionBase > 0
    ? Math.round((stats.cashCollectedThisMonth / collectionBase) * 100)
    : 0
  const profitTone = stats && stats.realProfitThisMonth >= 0 ? 'text-emerald-700' : 'text-red-700'

  return (
    <div className="p-6 space-y-6 max-w-7xl">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-zinc-900">Boshqaruv paneli</h1>
          <p className="text-sm text-zinc-500 mt-0.5">
            Naqd tushum, kutilayotgan to'lovlar va nasiya holati
          </p>
        </div>
        <Badge variant="outline" className="h-6 w-fit rounded-md border-zinc-200 text-zinc-600">
          {new Date().toLocaleDateString('uz-UZ', { month: 'long', year: 'numeric' })}
        </Badge>
      </div>

      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-4 py-3">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-zinc-400">Yuklanmoqda...</div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
            <Card className="rounded-lg lg:col-span-5">
              <CardHeader className="border-b border-zinc-100">
                <CardTitle>Bu oy pul oqimi</CardTitle>
                <CardDescription>Tushgan pul va oy oxirigacha kutilayotgan to'lov</CardDescription>
                <CardAction>
                  <WalletCards className="size-5 text-zinc-400" />
                </CardAction>
              </CardHeader>
              <CardContent className="space-y-5">
                <div>
                  <div className="text-xs font-medium uppercase text-zinc-500">Tushgan pul</div>
                  <div className="mt-1 text-3xl font-bold tracking-tight text-zinc-900">
                    {fmt(stats?.cashCollectedThisMonth ?? 0)}
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-zinc-500">
                    <span>Yig'ilgan ulush</span>
                    <span className="font-semibold text-zinc-800">{collectionRate}%</span>
                  </div>
                  <Progress value={collectionRate} />
                  <div className="flex items-center justify-between text-xs text-zinc-500">
                    <span>Kutilmoqda: {fmt(stats?.expectedThisMonth ?? 0)}</span>
                    <span>Jami oqim: {fmt(collectionBase)}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:col-span-7">
              <Card className="rounded-lg">
                <CardHeader>
                  <CardDescription>Yalpi foyda</CardDescription>
                  <CardAction><TrendingUp className="size-4 text-zinc-400" /></CardAction>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-zinc-900">
                    {fmt(stats?.accrualGrossProfitThisMonth ?? 0)}
                  </div>
                  <p className="mt-2 text-xs text-zinc-500">Bu oy sotilgan qurilmalar bo'yicha</p>
                </CardContent>
              </Card>

              <Card className="rounded-lg">
                <CardHeader>
                  <CardDescription>Naqd asosdagi foyda</CardDescription>
                  <CardAction><Banknote className="size-4 text-zinc-400" /></CardAction>
                </CardHeader>
                <CardContent>
                  <div className={`text-2xl font-bold ${profitTone}`}>
                    {fmtSigned(stats?.realProfitThisMonth ?? 0)}
                  </div>
                  <p className="mt-2 text-xs text-zinc-500">Tushum minus sotilgan mahsulot tannarxi</p>
                </CardContent>
              </Card>

              <Card className="rounded-lg">
                <CardHeader>
                  <CardDescription>Ombordagi tannarx</CardDescription>
                  <CardAction><Package className="size-4 text-zinc-400" /></CardAction>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-zinc-900">
                    {fmt(stats?.inventoryPurchaseCost ?? 0)}
                  </div>
                  <p className="mt-2 text-xs text-zinc-500">Sotilmagan va band qilingan qurilmalar</p>
                </CardContent>
              </Card>

              <Card className="rounded-lg border-red-200 bg-red-50/40">
                <CardHeader>
                  <CardDescription className="text-red-700">Kechikkan to'lovlar</CardDescription>
                  <CardAction><AlertTriangle className="size-4 text-red-500" /></CardAction>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-red-700">
                    {fmt(stats?.overdueMoney ?? 0)}
                  </div>
                  <p className="mt-2 text-xs text-red-700/70">
                    {stats?.overdueCount ?? 0} ta muddatdan o'tgan yozuv
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Card className="rounded-lg" size="sm">
              <CardContent className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs text-zinc-500">Jami qurilmalar</div>
                  <div className="mt-1 text-xl font-bold text-zinc-900">{stats?.totalDevices ?? 0}</div>
                </div>
                <Package className="size-5 text-zinc-400" />
              </CardContent>
            </Card>
            <Card className="rounded-lg" size="sm">
              <CardContent className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs text-zinc-500">Bu oy sotildi</div>
                  <div className="mt-1 text-xl font-bold text-zinc-900">{stats?.soldThisMonth ?? 0}</div>
                </div>
                <ReceiptText className="size-5 text-zinc-400" />
              </CardContent>
            </Card>
            <Card className="rounded-lg" size="sm">
              <CardContent className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs text-zinc-500">Faol nasiyalar</div>
                  <div className="mt-1 text-xl font-bold text-zinc-900">{stats?.activeNasiyalar ?? 0}</div>
                </div>
                <ClipboardList className="size-5 text-zinc-400" />
              </CardContent>
            </Card>
            <Card className="rounded-lg" size="sm">
              <CardContent className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs text-zinc-500">Bu oy kutilmoqda</div>
                  <div className="mt-1 text-xl font-bold text-zinc-900">{fmt(stats?.expectedThisMonth ?? 0)}</div>
                </div>
                <CalendarClock className="size-5 text-zinc-400" />
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card className="rounded-lg">
              <CardHeader className="border-b border-zinc-100">
                <CardTitle>Yaqin to'lov sanalari</CardTitle>
                <CardDescription>Nasiya bo'yicha eng yaqin va kechikkan oyliklar</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {stats?.upcomingPayments && stats.upcomingPayments.length > 0 ? (
                  stats.upcomingPayments.map((p, i) => (
                    <div key={i} className="flex items-center justify-between gap-3 py-3 border-b border-zinc-100 last:border-0">
                      <div>
                        <div className="text-sm font-medium text-zinc-900">{p.nasiya.customer.name}</div>
                        <div className="mt-0.5 text-xs text-zinc-500">
                          {p.nasiya.device.model} · {new Date(p.dueDate).toLocaleDateString('uz-UZ')}
                        </div>
                        <Badge variant="outline" className="mt-2 rounded-md border-zinc-200 text-zinc-500">
                          {statusLabel(p.status)}
                        </Badge>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-semibold text-zinc-900">{fmt(outstanding(p))}</div>
                        <div className="mt-0.5 text-xs text-zinc-400">qolgan</div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-sm text-zinc-400 py-4 text-center">To'lovlar yo'q</div>
                )}
              </CardContent>
            </Card>

            <Card className="rounded-lg">
              <CardHeader className="border-b border-zinc-100">
                <CardTitle>Oxirgi operatsiyalar</CardTitle>
                <CardDescription>Do'kon ichidagi oxirgi harakatlar</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {stats?.recentActivity && stats.recentActivity.length > 0 ? (
                  stats.recentActivity.map((a, i) => (
                    <div key={i} className="flex items-center justify-between py-2 border-b border-zinc-100 last:border-0">
                      <div className="text-sm text-zinc-700">{a.action}</div>
                      <div className="text-xs text-zinc-400 ml-4 whitespace-nowrap">
                        {new Date(a.createdAt).toLocaleDateString('uz-UZ')}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-sm text-zinc-400 py-4 text-center">Operatsiyalar yo'q</div>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
