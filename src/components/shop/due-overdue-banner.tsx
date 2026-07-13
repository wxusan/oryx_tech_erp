'use client'

import { useEffect, useMemo } from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CalendarCheck2 } from 'lucide-react'
import { formatPartitionedMoney, type CurrencyContext } from '@/lib/currency'
import { FINANCIAL_DATA_CHANGED_EVENT } from '@/lib/client-events'
import { queryKeys } from '@/lib/query-keys'
import { useAuthenticatedQueryScope } from '@/components/query-scope-context'
import type { ReceivableCohortSummary } from '@/lib/server/shop-stats-queries'

export interface DueOverdueSummary {
  dueToday: ReceivableCohortSummary
  overdue: ReceivableCohortSummary
  currency: CurrencyContext
  dayKey: string
}

function amountText(summary: ReceivableCohortSummary, currency: CurrencyContext) {
  return formatPartitionedMoney({
    amountUzs: summary.nativeUzs,
    amountUsd: summary.nativeUsd,
    displayCurrency: currency.currency,
    rate: currency.usdUzsRate,
  })
}

function countText(summary: ReceivableCohortSummary) {
  return `${summary.customerCount} ta mijoz · ${summary.dealCount} ta qarz`
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
        <Link
          href="/shop/tolovlar?cohort=OVERDUE"
          className="flex min-h-10 items-center gap-2 border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-800 hover:bg-red-100 sm:px-6 sm:text-sm"
        >
          <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="font-semibold">Muddati o'tgan:</span>{' '}
            {countText(summary.overdue)} · {amountText(summary.overdue, summary.currency)}
          </span>
          <span className="shrink-0 underline">Ko'rish</span>
        </Link>
      )}
      {summary.dueToday.dealCount > 0 && (
        <Link
          href="/shop/tolovlar?cohort=DUE_TODAY"
          className="flex min-h-10 items-center gap-2 border-b border-emerald-200 bg-emerald-50 px-4 py-2 text-xs text-emerald-900 hover:bg-emerald-100 sm:px-6 sm:text-sm"
        >
          <CalendarCheck2 className="size-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="font-semibold">Bugun to'lanadi:</span>{' '}
            {countText(summary.dueToday)} · {amountText(summary.dueToday, summary.currency)}
          </span>
          <span className="shrink-0 underline">Ko'rish</span>
        </Link>
      )}
    </div>
  )
}
