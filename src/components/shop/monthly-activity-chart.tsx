'use client'

import { useState, type ReactNode } from 'react'
import { Bar, BarChart, CartesianGrid, ReferenceLine, XAxis, YAxis } from 'recharts'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart'

export type MonthlyActivityCurrency = 'UZS' | 'USD'

export interface MonthlyActivityNativeMoney {
  UZS: number
  USD: number
}

export interface MonthlyActivityPoint {
  month: string
  contracts: MonthlyActivityNativeMoney
  payments?: MonthlyActivityNativeMoney
  refunds?: MonthlyActivityNativeMoney
  writeOffs?: MonthlyActivityNativeMoney
}

const ACTIVITY_CONFIG = {
  contracts: { label: 'Yangi shartnomalar', color: '#18181b' },
  payments: { label: 'Tushgan to‘lovlar', color: '#059669' },
  refunds: { label: 'Qaytarilgan pul', color: '#f59e0b' },
  writeOffs: { label: 'Hisobdan chiqarish', color: '#dc2626' },
} satisfies ChartConfig

const MONTHS = ['Yan', 'Fev', 'Mar', 'Apr', 'May', 'Iyn', 'Iyl', 'Avg', 'Sen', 'Okt', 'Noy', 'Dek'] as const

function monthLabel(month: string, includeYear = false) {
  const [yearText, monthText] = month.split('-')
  const label = MONTHS[Number(monthText) - 1] ?? month
  return includeYear ? `${label} ${yearText}` : label
}

function currencyMoneyLabel(value: number, currency: MonthlyActivityCurrency) {
  return currency === 'USD'
    ? `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `${Math.round(value).toLocaleString('ru-RU')} UZS`
}

function compactCurrencyValue(value: number, currency: MonthlyActivityCurrency) {
  const absolute = Math.abs(value)
  const sign = value < 0 ? '−' : ''
  const prefix = currency === 'USD' ? '$' : ''
  const suffix = currency === 'UZS' ? ' UZS' : ''
  if (absolute >= 1_000_000_000) return `${sign}${prefix}${(absolute / 1_000_000_000).toFixed(1)}B${suffix}`
  if (absolute >= 1_000_000) return `${sign}${prefix}${(absolute / 1_000_000).toFixed(1)}M${suffix}`
  if (absolute >= 1_000) return `${sign}${prefix}${Math.round(absolute / 1_000)}K${suffix}`
  return `${sign}${prefix}${Math.round(absolute)}${suffix}`
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-zinc-600">
      <span className="size-2.5 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />
      {label}
    </span>
  )
}

export function MonthlyActivityChart({
  activity,
  currency,
  showFinancials,
  titleId,
  toolbar,
}: {
  activity: MonthlyActivityPoint[]
  currency: MonthlyActivityCurrency
  showFinancials: boolean
  titleId: string
  toolbar?: ReactNode
}) {
  const [showWriteOffs, setShowWriteOffs] = useState(false)
  const chartRows = activity.map((row) => ({
    month: monthLabel(row.month),
    monthKey: row.month,
    contracts: row.contracts[currency],
    payments: row.payments?.[currency] ?? 0,
    refunds: -(row.refunds?.[currency] ?? 0),
    writeOffs: -(row.writeOffs?.[currency] ?? 0),
  }))
  const hasActivity = chartRows.some((row) => (
    row.contracts !== 0
    || (showFinancials && row.payments !== 0)
    || (showFinancials && row.refunds !== 0)
    || (showFinancials && showWriteOffs && row.writeOffs !== 0)
  ))
  const tickInterval = chartRows.length > 24 ? 2 : chartRows.length > 12 ? 1 : 0

  return (
    <Card className="min-w-0 rounded-xl">
      <CardHeader className="gap-2">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle id={titleId}>Oylik faollik</CardTitle>
            <CardDescription>Shartnoma va pul harakati, tanlangan asl valyutada.</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {toolbar}
            {showFinancials && (
              <button
                type="button"
                aria-pressed={showWriteOffs}
                title="Tarixiy hisobdan chiqarish harakatini ko‘rsatish yoki yashirish"
                onClick={() => setShowWriteOffs((value) => !value)}
                className="min-h-9 shrink-0 rounded-md border border-zinc-200 px-3 text-xs font-medium text-zinc-700 hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900"
              >
                Hisobdan chiqarish
              </button>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-3" aria-label="Grafik belgilar">
          <LegendItem color="#18181b" label="Shartnomalar" />
          {showFinancials && <LegendItem color="#059669" label="To‘lovlar" />}
          {showFinancials && <LegendItem color="#f59e0b" label="Qaytarishlar (pastda)" />}
          {showFinancials && showWriteOffs && <LegendItem color="#dc2626" label="Hisobdan chiqarish (pastda)" />}
        </div>
      </CardHeader>
      <CardContent>
        {hasActivity ? (
          <ChartContainer
            config={ACTIVITY_CONFIG}
            className="h-[300px] w-full"
            role="img"
            aria-labelledby={titleId}
          >
            <BarChart accessibilityLayer data={chartRows} margin={{ left: 0, right: 8, top: 8 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="month" interval={tickInterval} tickLine={false} axisLine={false} tickMargin={9} />
              <YAxis width={58} tickFormatter={(value) => compactCurrencyValue(Number(value), currency)} tickLine={false} axisLine={false} />
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
              {showFinancials && <Bar dataKey="payments" fill="var(--color-payments)" radius={[4, 4, 0, 0]} isAnimationActive={false} />}
              {showFinancials && <Bar dataKey="refunds" fill="var(--color-refunds)" radius={[0, 0, 4, 4]} isAnimationActive={false} />}
              {showFinancials && showWriteOffs && <Bar dataKey="writeOffs" fill="var(--color-writeOffs)" radius={[0, 0, 4, 4]} isAnimationActive={false} />}
            </BarChart>
          </ChartContainer>
        ) : (
          <div className="flex h-[300px] items-center justify-center rounded-lg border border-dashed border-zinc-200 px-6 text-center text-sm text-zinc-500">
            Tanlangan davr va valyutada harakat yo‘q.
          </div>
        )}
        <details className="mt-3 rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
          <summary className="cursor-pointer font-medium text-zinc-800">Aniq oylik qiymatlar</summary>
          <ul className="mt-2 max-h-52 space-y-2 overflow-y-auto">
            {chartRows.map((row) => (
              <li key={row.monthKey} className="flex flex-col gap-1 border-b border-zinc-200 pb-2 last:border-0 sm:flex-row sm:justify-between sm:gap-3">
                <span>{monthLabel(row.monthKey, true)}</span>
                <span className="font-mono sm:text-right">
                  Shartnoma {currencyMoneyLabel(row.contracts, currency)}
                  {showFinancials ? ` · To‘lov ${currencyMoneyLabel(row.payments, currency)} · Qaytarish ${currencyMoneyLabel(Math.abs(row.refunds), currency)}` : ''}
                  {showFinancials && showWriteOffs ? ` · Hisobdan chiqarish ${currencyMoneyLabel(Math.abs(row.writeOffs), currency)}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </details>
      </CardContent>
    </Card>
  )
}
