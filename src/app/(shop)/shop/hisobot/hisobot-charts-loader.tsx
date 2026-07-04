'use client'

import dynamic from 'next/dynamic'
import type { ChartConfig } from '@/components/ui/chart'
import type { CurrencyContext } from '@/lib/currency'

interface ChartDatum {
  name: string
  amount: number
  fill: string
}

const HisobotCharts = dynamic(() => import('./hisobot-charts'), {
  ssr: false,
  loading: () => (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
      <div className="h-[344px] rounded-lg border border-zinc-200 bg-zinc-50 xl:col-span-3" />
      <div className="h-[344px] rounded-lg border border-zinc-200 bg-zinc-50 xl:col-span-2" />
    </div>
  ),
})

export default function HisobotChartsLoader({
  cashFlowData,
  businessData,
  chartConfig,
  currency,
}: {
  cashFlowData: ChartDatum[]
  businessData: ChartDatum[]
  chartConfig: ChartConfig
  currency: CurrencyContext
}) {
  return (
    <HisobotCharts
      cashFlowData={cashFlowData}
      businessData={businessData}
      chartConfig={chartConfig}
      currency={currency}
    />
  )
}
