'use client'

import { useState } from 'react'
import { Bar, BarChart, CartesianGrid, ReferenceLine, XAxis, YAxis } from 'recharts'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart'
import { totalDueBuckets, type CustomerProfileAnalytics, type CustomerProfileCurrency } from '@/lib/customer-profile-analytics'
import { activityMonthLabel, compactCurrencyValue, currencyMoneyLabel } from './customer-profile-format'

const ACTIVITY_CONFIG = {
  contracts: { label: 'Yangi shartnomalar', color: '#18181b' },
  payments: { label: 'Tushgan to‘lovlar', color: '#059669' },
  refunds: { label: 'Qaytarilgan pul', color: '#f59e0b' },
  writeOffs: { label: 'Hisobdan chiqarish', color: '#dc2626' },
} satisfies ChartConfig

const DEBT_CONFIG = {
  overdue: { label: 'Muddati o‘tgan', color: '#dc2626' },
  today: { label: 'Bugun', color: '#f59e0b' },
  next7Days: { label: 'Keyingi 7 kun', color: '#2563eb' },
  days8To30: { label: '8–30 kun', color: '#7c3aed' },
  later: { label: '30 kundan keyin', color: '#71717a' },
} satisfies ChartConfig

const DEBT_LABELS = {
  overdue: 'Muddati o‘tgan',
  today: 'Bugun',
  next7Days: 'Keyingi 7 kun',
  days8To30: '8–30 kun',
  later: '30 kundan keyin',
} as const

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-zinc-600">
      <span className="size-2.5 rounded-sm" style={{ backgroundColor: color }} aria-hidden="true" /> {label}
    </span>
  )
}

export default function CustomerProfileCharts({
  analytics,
  currency,
}: {
  analytics: CustomerProfileAnalytics
  currency: CustomerProfileCurrency
}) {
  const owner = analytics.visibility === 'OWNER_FINANCIAL'
  const [showWriteOffs, setShowWriteOffs] = useState(false)
  const activity = analytics.activity.map((row, index) => ({
    month: activityMonthLabel(row.month, analytics.months === 24 && (index === 0 || row.month.endsWith('-01'))),
    monthKey: row.month,
    contracts: row.contracts[currency],
    payments: row.payments?.[currency] ?? 0,
    refunds: -(row.refunds?.[currency] ?? 0),
    writeOffs: -(row.writeOffs?.[currency] ?? 0),
  }))
  const hasActivity = activity.some((row) => (
    row.contracts !== 0 || row.payments !== 0 || row.refunds !== 0 || (showWriteOffs && row.writeOffs !== 0)
  ))
  const debt = analytics.obligations[currency]
  const hasDebt = totalDueBuckets(debt) > 0
  const debtRows = [{ name: currency, ...debt }]

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Card className="min-w-0 rounded-xl">
        <CardHeader className="gap-2">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle id="customer-activity-chart-title">Oylik faollik</CardTitle>
              <CardDescription>Shartnoma va pul harakati, tanlangan asl valyutada.</CardDescription>
            </div>
            {owner && (
              <button
                type="button"
                aria-pressed={showWriteOffs}
                onClick={() => setShowWriteOffs((value) => !value)}
                className="min-h-9 shrink-0 rounded-md border border-zinc-200 px-3 text-xs font-medium text-zinc-700 hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900"
              >
                Hisobdan chiqarish
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-3" aria-label="Grafik belgilar">
            <LegendItem color="#18181b" label="Shartnomalar" />
            {owner && <LegendItem color="#059669" label="To‘lovlar" />}
            {owner && <LegendItem color="#f59e0b" label="Qaytarishlar (pastda)" />}
            {owner && showWriteOffs && <LegendItem color="#dc2626" label="Hisobdan chiqarish (pastda)" />}
          </div>
        </CardHeader>
        <CardContent>
          {hasActivity ? (
            <ChartContainer
              config={ACTIVITY_CONFIG}
              className="h-[250px] w-full"
              role="img"
              aria-labelledby="customer-activity-chart-title"
            >
              <BarChart accessibilityLayer data={activity} margin={{ left: 0, right: 8, top: 8 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="month" interval={analytics.months === 24 ? 2 : 0} tickLine={false} axisLine={false} tickMargin={9} />
                <YAxis width={48} tickFormatter={(value) => compactCurrencyValue(Number(value), currency)} tickLine={false} axisLine={false} />
                <ReferenceLine y={0} stroke="#a1a1aa" />
                <ChartTooltip
                  cursor={{ fill: '#f4f4f5' }}
                  content={<ChartTooltipContent formatter={(value, name) => (
                    <div className="flex min-w-44 items-center justify-between gap-4">
                      <span className="text-zinc-500">{ACTIVITY_CONFIG[String(name) as keyof typeof ACTIVITY_CONFIG]?.label}</span>
                      <span className="font-mono font-semibold text-zinc-950">{currencyMoneyLabel(Math.abs(Number(value)), currency)}</span>
                    </div>
                  )} />}
                />
                <Bar dataKey="contracts" fill="var(--color-contracts)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                {owner && <Bar dataKey="payments" fill="var(--color-payments)" radius={[4, 4, 0, 0]} isAnimationActive={false} />}
                {owner && <Bar dataKey="refunds" fill="var(--color-refunds)" radius={[0, 0, 4, 4]} isAnimationActive={false} />}
                {owner && showWriteOffs && <Bar dataKey="writeOffs" fill="var(--color-writeOffs)" radius={[0, 0, 4, 4]} isAnimationActive={false} />}
              </BarChart>
            </ChartContainer>
          ) : (
            <div className="flex h-[250px] items-center justify-center rounded-lg border border-dashed border-zinc-200 px-6 text-center text-sm text-zinc-500">
              Tanlangan davr va valyutada harakat yo‘q.
            </div>
          )}
          <details className="mt-3 rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
            <summary className="cursor-pointer font-medium text-zinc-800">Aniq oylik qiymatlar</summary>
            <ul className="mt-2 max-h-48 space-y-2 overflow-y-auto">
              {activity.map((row) => (
                <li key={row.monthKey} className="flex flex-wrap justify-between gap-x-3 border-b border-zinc-200 pb-1.5 last:border-0">
                  <span>{activityMonthLabel(row.monthKey, true)}</span>
                  <span className="font-mono">
                    Shartnoma {currencyMoneyLabel(row.contracts, currency)}
                    {owner ? ` · To‘lov ${currencyMoneyLabel(row.payments, currency)} · Qaytarish ${currencyMoneyLabel(Math.abs(row.refunds), currency)}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        </CardContent>
      </Card>

      <Card className="min-w-0 rounded-xl">
        <CardHeader>
          <CardTitle id="customer-debt-chart-title">Qarz muddati</CardTitle>
          <CardDescription>Ochiq qarz qachon to‘lanishi kerakligini ko‘rsatadi.</CardDescription>
        </CardHeader>
        <CardContent>
          {hasDebt ? (
            <ChartContainer
              config={DEBT_CONFIG}
              className="h-[150px] w-full"
              role="img"
              aria-labelledby="customer-debt-chart-title"
            >
              <BarChart accessibilityLayer data={debtRows} layout="vertical" margin={{ left: 0, right: 8 }}>
                <XAxis type="number" tickFormatter={(value) => compactCurrencyValue(Number(value), currency)} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="name" width={38} tickLine={false} axisLine={false} />
                <ChartTooltip
                  cursor={false}
                  content={<ChartTooltipContent formatter={(value, name) => (
                    <div className="flex min-w-44 items-center justify-between gap-4">
                      <span className="text-zinc-500">{DEBT_LABELS[String(name) as keyof typeof DEBT_LABELS]}</span>
                      <span className="font-mono font-semibold text-zinc-950">{currencyMoneyLabel(Number(value), currency)}</span>
                    </div>
                  )} />}
                />
                {(Object.keys(DEBT_LABELS) as Array<keyof typeof DEBT_LABELS>).map((key) => (
                  <Bar key={key} dataKey={key} stackId="debt" fill={`var(--color-${key})`} isAnimationActive={false} />
                ))}
              </BarChart>
            </ChartContainer>
          ) : (
            <div className="flex h-[150px] items-center justify-center rounded-lg border border-dashed border-zinc-200 px-6 text-center text-sm text-zinc-500">
              {currency} bo‘yicha ochiq qarz yo‘q.
            </div>
          )}
          <ul className="mt-4 space-y-2" aria-label={`${currency} qarz muddati bo‘yicha aniq qiymatlar`}>
            {(Object.keys(DEBT_LABELS) as Array<keyof typeof DEBT_LABELS>).map((key) => (
              <li key={key} className="flex min-h-7 items-center justify-between gap-3 text-xs">
                <span className="inline-flex items-center gap-2 text-zinc-600">
                  <span className="size-2.5 rounded-sm" style={{ backgroundColor: DEBT_CONFIG[key].color }} aria-hidden="true" />
                  {DEBT_LABELS[key]}
                </span>
                <strong className="font-mono font-semibold text-zinc-950">{currencyMoneyLabel(debt[key], currency)}</strong>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}
