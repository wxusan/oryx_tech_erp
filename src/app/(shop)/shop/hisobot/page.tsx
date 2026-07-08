import { redirect } from 'next/navigation'
import {
  AlertTriangle,
  Boxes,
  CalendarClock,
  CircleDollarSign,
  RotateCcw,
  TrendingUp,
} from 'lucide-react'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import type { ChartConfig } from '@/components/ui/chart'
import { requireApiSession } from '@/lib/api-auth'
import { getShopStats } from '@/lib/server/shop-stats'
import { getShopCurrencyContext } from '@/lib/server/currency'
import { formatMoneyByCurrency, formatMoneyWithBase, type CurrencyContext } from '@/lib/currency'
import HisobotChartsLoader from './hisobot-charts-loader'

function fmt(value: number, currency: CurrencyContext) {
  return formatMoneyByCurrency(value, currency.currency, currency.usdUzsRate)
}

function fmtBase(value: number, currency: CurrencyContext) {
  return formatMoneyWithBase(value, currency.currency, currency.usdUzsRate)
}

function uzMonthLabel(date: Date) {
  const months = [
    'Yanvar',
    'Fevral',
    'Mart',
    'Aprel',
    'May',
    'Iyun',
    'Iyul',
    'Avgust',
    'Sentabr',
    'Oktabr',
    'Noyabr',
    'Dekabr',
  ]
  return `${months[date.getMonth()]} ${date.getFullYear()}`
}

export default async function ShopReportPage() {
  const guarded = await requireApiSession()
  if (!guarded.ok || !guarded.shopId) redirect('/shop/login')

  const [stats, currency] = await Promise.all([
    getShopStats(guarded.session, guarded.shopId),
    getShopCurrencyContext(guarded.shopId),
  ])

  const monthLabel = uzMonthLabel(new Date())
  const collected = stats.grossCashInThisMonth ?? stats.cashCollectedThisMonth ?? stats.cashReceivedThisMonth
  const netCash = stats.netCashFlowThisMonth ?? stats.netCashAfterReturnsThisMonth
  const expected = stats.expectedThisMonth
  const overdue = stats.overdueMoney
  const refunds = stats.returnRefundsThisMonth
  const inventory = stats.inventoryPurchaseCost
  const grossProfit = stats.accrualGrossProfitThisMonth ?? stats.realProfitThisMonth
  const interestProfit = stats.nasiyaInterestThisMonth ?? 0
  const collectionBase = collected + expected
  const collectionRate = collectionBase > 0 ? Math.round((collected / collectionBase) * 100) : 0

  const cashFlowData = [
    { name: 'Umumiy aylanma', amount: collected, fill: 'var(--color-collected)' },
    { name: 'Sof tushum', amount: netCash, fill: 'var(--color-net)' },
    { name: 'Qaytarilgan summa', amount: refunds, fill: 'var(--color-refunds)' },
    { name: 'Kutilmoqda', amount: expected, fill: 'var(--color-expected)' },
    { name: 'Kechikkan', amount: overdue, fill: 'var(--color-overdue)' },
  ]

  const businessData = [
    { name: 'Ombor', amount: inventory, fill: 'var(--color-inventory)' },
    { name: 'Sotuv foydasi', amount: grossProfit, fill: 'var(--color-gross)' },
    { name: 'Nasiya foizi', amount: interestProfit, fill: 'var(--color-interest)' },
  ]

  const chartConfig = {
    collected: { label: 'Umumiy aylanma', color: '#2563eb' },
    net: { label: 'Sof tushum', color: '#15803d' },
    refunds: { label: 'Qaytarilgan summa', color: '#9333ea' },
    expected: { label: 'Kutilmoqda', color: '#0f766e' },
    overdue: { label: 'Kechikkan', color: '#dc2626' },
    inventory: { label: 'Ombor', color: '#64748b' },
    gross: { label: 'Sotuv foydasi', color: '#16a34a' },
    interest: { label: 'Nasiya foizi', color: '#0891b2' },
  } satisfies ChartConfig

  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="rounded-md border-zinc-200 bg-white text-zinc-600">
              {monthLabel} · {currency.currency}
            </Badge>
            <Badge variant={overdue > 0 ? 'destructive' : 'secondary'} className="rounded-md">
              {overdue > 0 ? "Kechikkan to'lov bor" : "Kechikkan to'lov yo'q"}
            </Badge>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900">Hisobot</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Umumiy aylanma/sof tushum, qarzdorlik, ombor tannarxi va sotuv foydasi ko'rsatkichlari
          </p>
        </div>
        <div className="grid grid-cols-1 gap-2 rounded-lg border border-zinc-200 bg-white p-2 text-xs text-zinc-500 sm:flex">
          <div className="rounded-md bg-zinc-50 px-3 py-2">
            <div>Yig'ish darajasi</div>
            <div className="mt-0.5 text-sm font-semibold text-zinc-900">{collectionRate}%</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Card className="rounded-lg">
              <CardHeader>
                <CardDescription title="Faqat haqiqatda qabul qilingan to'lovlar (naqd sotuv va nasiya to'lovlari) — hali to'lanmagan sotuvlar bu yerga kirmaydi">
                  Bu oy tushgan pul
                </CardDescription>
                <CardAction><CircleDollarSign className="size-4 text-blue-600" /></CardAction>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-zinc-900">{fmt(collected, currency)}</div>
                <div className="mt-3 space-y-2">
                  <div className="flex justify-between text-xs text-zinc-500">
                    <span>Kutilgan pulga nisbatan</span>
                    <span className="font-semibold text-zinc-800">{collectionRate}%</span>
                  </div>
                  <Progress value={collectionRate} className="[&_[data-slot=progress-fill]]:bg-blue-600" />
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-lg">
              <CardHeader>
                <CardDescription>Bu oy kutilmoqda</CardDescription>
                <CardAction><CalendarClock className="size-4 text-teal-700" /></CardAction>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-zinc-900">{fmt(expected, currency)}</div>
                <p className="mt-3 text-xs text-zinc-500">
                  Nasiya va qisman sotuvlardan qolgan oy ichidagi summa · joriy kurs bo'yicha
                </p>
              </CardContent>
            </Card>

            <Card className="rounded-lg">
              <CardHeader>
                <CardDescription>Qaytarilgan pul</CardDescription>
                <CardAction><RotateCcw className="size-4 text-purple-600" /></CardAction>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-zinc-900">{fmt(refunds, currency)}</div>
                <p className="mt-3 text-xs text-zinc-500">
                  Bu oy {stats.returnsThisMonth} ta qaytarish bo'yicha yozilgan summa
                </p>
              </CardContent>
            </Card>

            <Card className="rounded-lg border-red-200 bg-red-50/50">
              <CardHeader>
                <CardDescription className="text-red-700">Muddati o'tgan qarz</CardDescription>
                <CardAction><AlertTriangle className="size-4 text-red-600" /></CardAction>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-red-700">{fmt(overdue, currency)}</div>
                <p className="mt-3 text-xs text-red-700/70">
                  Bugun ko'rib chiqilishi kerak bo'lgan qarzdorlik · joriy kurs bo'yicha
                </p>
              </CardContent>
            </Card>

            <Card className="rounded-lg">
              <CardHeader>
                <CardDescription>Ombordagi tannarx</CardDescription>
                <CardAction><Boxes className="size-4 text-slate-500" /></CardAction>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-zinc-900">{fmt(inventory, currency)}</div>
                <p className="mt-3 text-xs text-zinc-500">Hali sotilmagan qurilmalarga bog'langan pul</p>
              </CardContent>
            </Card>
      </div>

      <HisobotChartsLoader
            cashFlowData={cashFlowData}
            businessData={businessData}
            chartConfig={chartConfig}
            currency={currency}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card className="rounded-lg">
              <CardHeader>
                <CardDescription>Sotuv foydasi</CardDescription>
                <CardAction><TrendingUp className="size-4 text-emerald-600" /></CardAction>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-zinc-900">{fmt(grossProfit, currency)}</div>
                <p className="mt-3 text-xs text-zinc-500">
                  Sotilgan qurilmalar narxidan tannarx ayirilgandagi foyda · sotuv amalga oshirilgan zahoti hisoblanadi, to'lov holatidan qat'iy nazar
                </p>
              </CardContent>
            </Card>

            <Card className="rounded-lg">
              <CardHeader>
                <CardDescription>Qisqa xulosa</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {[
                  ["Yig'ilgan", fmtBase(collected, currency)],
                  ['Kutilayotgan', fmt(expected, currency)],
                  ['Kechikkan', fmt(overdue, currency)],
                  ['Nasiya foizi', fmt(interestProfit, currency)],
                  ['Ombor', fmt(inventory, currency)],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-center justify-between border-b border-zinc-100 pb-2 last:border-0 last:pb-0">
                    <span className="text-sm text-zinc-500">{label}</span>
                    <span className="text-sm font-semibold text-zinc-900">{value}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
      </div>
    </div>
  )
}
