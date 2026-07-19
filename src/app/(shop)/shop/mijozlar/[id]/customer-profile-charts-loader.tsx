'use client'

import dynamic from 'next/dynamic'
import type { CustomerProfileAnalytics, CustomerProfileCurrency } from '@/lib/customer-profile-analytics'

const CustomerProfileCharts = dynamic(() => import('./customer-profile-charts'), {
  ssr: false,
  loading: () => (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2" role="status" aria-label="Mijoz grafiklari yuklanmoqda">
      <div className="h-[430px] animate-pulse rounded-xl border border-zinc-200 bg-zinc-100" />
      <div className="h-[430px] animate-pulse rounded-xl border border-zinc-200 bg-zinc-100" />
    </div>
  ),
})

export default function CustomerProfileChartsLoader({
  analytics,
  currency,
}: {
  analytics: CustomerProfileAnalytics
  currency: CustomerProfileCurrency
}) {
  return <CustomerProfileCharts analytics={analytics} currency={currency} />
}
