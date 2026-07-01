'use client'

import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  Boxes,
  CalendarClock,
  CircleDollarSign,
  TrendingUp,
} from 'lucide-react'
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'
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
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart'
import type { ChartConfig } from '@/components/ui/chart'

interface ShopStats {
  cashReceivedThisMonth: number
  expectedThisMonth: number
  overdueMoney: number
  inventoryPurchaseCost: number
  realProfitThisMonth: number
  accrualGrossProfitThisMonth: number
  cashCollectedThisMonth: number
}

function fmt(value: number) {
  return `${Number(value).toLocaleString('ru-RU')} so'm`
}

function fmtCompact(value: number) {
  if (Math.abs(value) >= 1000000) return `${(value / 1000000).toFixed(1)}M`
  if (Math.abs(value) >= 1000) return `${Math.round(value / 1000)}K`
  return String(value)
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

export default function ShopReportPage() {
  const [stats, setStats] = useState<ShopStats | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/stats/shop')
      .then((res) => res.json())
      .then((json) => {
        if (json.success) setStats(json.data)
        else setError(json.error || 'Hisobot yuklanmadi')
      })
      .catch(() => setError('Hisobot yuklanmadi'))
  }, [])

  const monthLabel = uzMonthLabel(new Date())
  const collected = stats?.cashCollectedThisMonth ?? stats?.cashReceivedThisMonth ?? 0
  const expected = stats?.expectedThisMonth ?? 0
  const overdue = stats?.overdueMoney ?? 0
  const inventory = stats?.inventoryPurchaseCost ?? 0
  const grossProfit = stats?.accrualGrossProfitThisMonth ?? stats?.realProfitThisMonth ?? 0
  const collectionBase = collected + expected
  const collectionRate = collectionBase > 0 ? Math.round((collected / collectionBase) * 100) : 0

  const cashFlowData = [
    { name: 'Tushum', amount: collected, fill: 'var(--color-collected)' },
    { name: 'Kutilmoqda', amount: expected, fill: 'var(--color-expected)' },
    { name: 'Kechikkan', amount: overdue, fill: 'var(--color-overdue)' },
  ]

  const businessData = [
    { name: 'Ombor', amount: inventory, fill: 'var(--color-inventory)' },
    { name: 'Yalpi foyda', amount: grossProfit, fill: 'var(--color-gross)' },
  ]

  const chartConfig = {
    collected: { label: 'Tushum', color: '#2563eb' },
    expected: { label: 'Kutilmoqda', color: '#0f766e' },
    overdue: { label: 'Kechikkan', color: '#dc2626' },
    inventory: { label: 'Ombor', color: '#64748b' },
    gross: { label: 'Yalpi foyda', color: '#16a34a' },
  } satisfies ChartConfig

  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="rounded-md border-zinc-200 bg-white text-zinc-600">
              {monthLabel}
            </Badge>
            <Badge variant={overdue > 0 ? 'destructive' : 'secondary'} className="rounded-md">
              {overdue > 0 ? "Kechikkan to'lov bor" : "Kechikkan to'lov yo'q"}
            </Badge>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900">Hisobot</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Tushum, qarzdorlik, ombor tannarxi va foyda ko'rsatkichlari
          </p>
        </div>
        <div className="grid grid-cols-1 gap-2 rounded-lg border border-zinc-200 bg-white p-2 text-xs text-zinc-500 sm:flex">
          <div className="rounded-md bg-zinc-50 px-3 py-2">
            <div>Yig'ish darajasi</div>
            <div className="mt-0.5 text-sm font-semibold text-zinc-900">{collectionRate}%</div>
          </div>
        </div>
      </div>

      {error && <div className="text-sm text-red-600 border border-red-200 bg-red-50 rounded px-4 py-3">{error}</div>}

      {!stats ? (
        <Card className="rounded-lg">
          <CardContent className="py-10 text-sm text-zinc-400">Yuklanmoqda...</CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Card className="rounded-lg">
              <CardHeader>
                <CardDescription>Bu oy tushgan pul</CardDescription>
                <CardAction><CircleDollarSign className="size-4 text-blue-600" /></CardAction>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-zinc-900">{fmt(collected)}</div>
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
                <div className="text-2xl font-bold text-zinc-900">{fmt(expected)}</div>
                <p className="mt-3 text-xs text-zinc-500">Nasiya va qisman sotuvlardan qolgan oy ichidagi summa</p>
              </CardContent>
            </Card>

            <Card className="rounded-lg border-red-200 bg-red-50/50">
              <CardHeader>
                <CardDescription className="text-red-700">Muddati o'tgan qarz</CardDescription>
                <CardAction><AlertTriangle className="size-4 text-red-600" /></CardAction>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-red-700">{fmt(overdue)}</div>
                <p className="mt-3 text-xs text-red-700/70">Bugun ko'rib chiqilishi kerak bo'lgan qarzdorlik</p>
              </CardContent>
            </Card>

            <Card className="rounded-lg">
              <CardHeader>
                <CardDescription>Ombordagi tannarx</CardDescription>
                <CardAction><Boxes className="size-4 text-slate-500" /></CardAction>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-zinc-900">{fmt(inventory)}</div>
                <p className="mt-3 text-xs text-zinc-500">Hali sotilmagan qurilmalarga bog'langan pul</p>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
            <Card className="rounded-lg xl:col-span-3">
              <CardHeader>
                <CardTitle>Pul oqimi</CardTitle>
                <CardDescription>Tushgan, kutilayotgan va kechikkan summalar</CardDescription>
              </CardHeader>
              <CardContent>
                <ChartContainer config={chartConfig} className="h-[280px] w-full">
                  <BarChart accessibilityLayer data={cashFlowData} margin={{ left: 0, right: 10 }}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="name" tickLine={false} axisLine={false} tickMargin={10} />
                    <YAxis tickFormatter={fmtCompact} tickLine={false} axisLine={false} width={42} />
                    <ChartTooltip
                      cursor={false}
                      content={
                        <ChartTooltipContent
                          hideLabel
                          formatter={(value, _name, item) => (
                            <div className="flex min-w-40 items-center justify-between gap-4">
                              <span className="text-zinc-500">{String(item.payload?.name ?? 'Summa')}</span>
                              <span className="font-mono font-semibold text-zinc-900">
                                {fmt(Number(value))}
                              </span>
                            </div>
                          )}
                        />
                      }
                    />
                    <Bar dataKey="amount" radius={[6, 6, 2, 2]} />
                  </BarChart>
                </ChartContainer>
              </CardContent>
            </Card>

            <Card className="rounded-lg xl:col-span-2">
              <CardHeader>
                <CardTitle>Foyda va kapital</CardTitle>
                <CardDescription>Ombor qiymati va yalpi foyda</CardDescription>
              </CardHeader>
              <CardContent>
                <ChartContainer config={chartConfig} className="h-[280px] w-full">
                  <BarChart accessibilityLayer data={businessData} layout="vertical" margin={{ left: 8, right: 16 }}>
                    <CartesianGrid horizontal={false} />
                    <XAxis type="number" tickFormatter={fmtCompact} tickLine={false} axisLine={false} />
                    <YAxis dataKey="name" type="category" tickLine={false} axisLine={false} width={78} />
                    <ChartTooltip
                      cursor={false}
                      content={
                        <ChartTooltipContent
                          hideLabel
                          formatter={(value, _name, item) => (
                            <div className="flex min-w-40 items-center justify-between gap-4">
                              <span className="text-zinc-500">{String(item.payload?.name ?? 'Summa')}</span>
                              <span className="font-mono font-semibold text-zinc-900">
                                {fmt(Number(value))}
                              </span>
                            </div>
                          )}
                        />
                      }
                    />
                    <Bar dataKey="amount" radius={[2, 6, 6, 2]} />
                  </BarChart>
                </ChartContainer>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card className="rounded-lg">
              <CardHeader>
                <CardDescription>Hisoblangan yalpi foyda</CardDescription>
                <CardAction><TrendingUp className="size-4 text-emerald-600" /></CardAction>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-zinc-900">{fmt(grossProfit)}</div>
                <p className="mt-3 text-xs text-zinc-500">Sotilgan/nasiya qilingan qurilmalar bo'yicha</p>
              </CardContent>
            </Card>

            <Card className="rounded-lg">
              <CardHeader>
                <CardDescription>Qisqa xulosa</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {[
                  ["Yig'ilgan", fmt(collected)],
                  ['Kutilayotgan', fmt(expected)],
                  ['Kechikkan', fmt(overdue)],
                  ['Ombor', fmt(inventory)],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-center justify-between border-b border-zinc-100 pb-2 last:border-0 last:pb-0">
                    <span className="text-sm text-zinc-500">{label}</span>
                    <span className="text-sm font-semibold text-zinc-900">{value}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
