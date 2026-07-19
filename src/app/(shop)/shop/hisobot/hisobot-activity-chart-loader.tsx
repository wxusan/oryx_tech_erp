'use client'

import dynamic from 'next/dynamic'
import type { CurrencyContext } from '@/lib/currency'
import type { ShopMonthlyReportPoint } from '@/lib/server/shop-report-range'

const HisobotActivityChart = dynamic(() => import('./hisobot-activity-chart'), {
  ssr: false,
  loading: () => <div className="h-[430px] rounded-xl border border-zinc-200 bg-zinc-50" role="status" aria-label="Oylik faollik grafigi yuklanmoqda" />,
})

export default function HisobotActivityChartLoader({
  months,
  currencyContext,
}: {
  months: ShopMonthlyReportPoint[]
  currencyContext: CurrencyContext
}) {
  return <HisobotActivityChart months={months} currencyContext={currencyContext} />
}
