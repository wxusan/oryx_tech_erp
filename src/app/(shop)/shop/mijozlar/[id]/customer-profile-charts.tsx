'use client'

import { Bar, BarChart, XAxis, YAxis } from 'recharts'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart'
import { MonthlyActivityChart } from '@/components/shop/monthly-activity-chart'
import { totalDueBuckets, type CustomerProfileAnalytics, type CustomerProfileCurrency } from '@/lib/customer-profile-analytics'
import { compactCurrencyValue, currencyMoneyLabel } from './customer-profile-format'

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

export default function CustomerProfileCharts({
  analytics,
  currency,
}: {
  analytics: CustomerProfileAnalytics
  currency: CustomerProfileCurrency
}) {
  const owner = analytics.visibility === 'OWNER_FINANCIAL'
  const debt = analytics.obligations[currency]
  const hasDebt = totalDueBuckets(debt) > 0
  const debtRows = [{ name: currency, ...debt }]

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <MonthlyActivityChart
        activity={analytics.activity}
        currency={currency}
        showFinancials={owner}
        titleId="customer-activity-chart-title"
      />

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
