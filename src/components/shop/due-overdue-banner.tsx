'use client'

import { useEffect, useMemo } from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CalendarCheck2 } from 'lucide-react'
import { formatPartitionedMoney, type CurrencyContext } from '@/lib/currency'
import { FINANCIAL_DATA_CHANGED_EVENT } from '@/lib/client-events'
import { queryKeys } from '@/lib/query-keys'
import { useAuthenticatedQueryScope } from '@/components/query-scope-context'
import type { ReceivableCohortSummary, ReceivableSourceSummary } from '@/lib/server/shop-stats-queries'

export interface DueOverdueSummary {
  dueToday: ReceivableCohortSummary
  overdue: ReceivableCohortSummary
  currency: CurrencyContext
  dayKey: string
}

function amountText(summary: ReceivableSourceSummary, currency: CurrencyContext) {
  return formatPartitionedMoney({
    amountUzs: summary.nativeUzs,
    amountUsd: summary.nativeUsd,
    displayCurrency: currency.currency,
    rate: currency.usdUzsRate,
  })
}

function sourceText(label: string, summary: ReceivableSourceSummary, currency: CurrencyContext) {
  return `${label}: ${summary.dealCount} ta · ${amountText(summary, currency)}`
}

function CohortSourceLinks({
  cohort,
  summary,
  currency,
}: {
  cohort: 'OVERDUE' | 'DUE_TODAY'
  summary: ReceivableCohortSummary
  currency: CurrencyContext
}) {
  const saleHref = `/shop/qurilmalar?tab=qarz&focus=${cohort}`
  const nasiyaHref = `/shop/nasiyalar?tab=${cohort}`
  const sale = summary.sources.sale
  const nasiya = summary.sources.nasiya

  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      {sale.dealCount > 0 && (
        <Link href={saleHref} className="font-medium underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current">
          {sourceText('Qarz', sale, currency)}
        </Link>
      )}
      {sale.dealCount > 0 && nasiya.dealCount > 0 && <span aria-hidden="true">·</span>}
      {nasiya.dealCount > 0 && (
        <Link href={nasiyaHref} className="font-medium underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current">
          {sourceText('Nasiya', nasiya, currency)}
        </Link>
      )}
    </span>
  )
}

export function DueOverdueBanner({ initialData }: { initialData?: DueOverdueSummary | null }) {
  const scope = useAuthenticatedQueryScope()
  const queryClient = useQueryClient()
  const queryKey = useMemo(() => queryKeys.list(scope, 'overdue', { view: 'summary' }), [scope])
  const query = useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      const response = await fetch('/api/stats/due-overdue', { signal, cache: 'no-store' })
      const json = await response.json() as { success: boolean; data?: DueOverdueSummary; error?: string }
      if (!response.ok || !json.success || !json.data) throw new Error(json.error || "To'lovlar xulosasi yuklanmadi")
      return json.data
    },
    initialData: initialData ?? undefined,
  })

  useEffect(() => {
    const refresh = () => queryClient.invalidateQueries({ queryKey })
    window.addEventListener(FINANCIAL_DATA_CHANGED_EVENT, refresh)
    return () => window.removeEventListener(FINANCIAL_DATA_CHANGED_EVENT, refresh)
  }, [queryClient, queryKey])

  const summary = query.data
  if (!summary || (summary.overdue.dealCount === 0 && summary.dueToday.dealCount === 0)) return null

  return (
    <div className="sticky top-14 z-30 flex shrink-0 flex-col" aria-label="To'lov muddati xabarlari">
      {summary.overdue.dealCount > 0 && (
        <div className="flex min-h-10 items-center gap-2 border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-800 sm:px-6 sm:text-sm">
          <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 sm:flex sm:items-center sm:gap-2">
            <span className="font-semibold">Muddati o'tgan:</span>{' '}
            <CohortSourceLinks cohort="OVERDUE" summary={summary.overdue} currency={summary.currency} />
          </span>
        </div>
      )}
      {summary.dueToday.dealCount > 0 && (
        <div className="flex min-h-10 items-center gap-2 border-b border-emerald-200 bg-emerald-50 px-4 py-2 text-xs text-emerald-900 sm:px-6 sm:text-sm">
          <CalendarCheck2 className="size-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 sm:flex sm:items-center sm:gap-2">
            <span className="font-semibold">Bugun to'lanadi:</span>{' '}
            <CohortSourceLinks cohort="DUE_TODAY" summary={summary.dueToday} currency={summary.currency} />
          </span>
        </div>
      )}
    </div>
  )
}
