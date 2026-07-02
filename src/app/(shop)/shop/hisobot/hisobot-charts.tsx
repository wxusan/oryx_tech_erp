'use client'

// Recharts is heavy (~100kb). This component is loaded via next/dynamic from the
// report page so recharts is split into its own chunk and never blocks the first
// paint of the report's stat cards.

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart'
import type { ChartConfig } from '@/components/ui/chart'

interface ChartDatum {
  name: string
  amount: number
  fill: string
}

function fmt(value: number) {
  return `${Number(value).toLocaleString('ru-RU')} so'm`
}

function fmtCompact(value: number) {
  if (Math.abs(value) >= 1000000) return `${(value / 1000000).toFixed(1)}M`
  if (Math.abs(value) >= 1000) return `${Math.round(value / 1000)}K`
  return String(value)
}

export default function HisobotCharts({
  cashFlowData,
  businessData,
  chartConfig,
}: {
  cashFlowData: ChartDatum[]
  businessData: ChartDatum[]
  chartConfig: ChartConfig
}) {
  return (
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
  )
}
