'use client'

import { useCallback, useEffect, useState } from 'react'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CalendarCheck2, ChevronLeft, ChevronRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StretchedLink } from '@/components/ui/stretched-link'
import { formatUserFacingMoney, type CurrencyContext } from '@/lib/currency'
import { uzDate } from '@/lib/dates'
import { queryKeys } from '@/lib/query-keys'
import { useAuthenticatedQueryScope } from '@/components/query-scope-context'
import { useShopAccess } from '@/components/shop/shop-access-context'
import type { ReceivableCohort } from '@/lib/server/shop-stats-queries'
import { QueryActivity } from '@/components/query-activity'
import { replaceListUrlState } from '@/lib/list-url-state'
import { markQueryIntent } from '@/lib/client-performance'

interface ReceivableItem {
  cohort: ReceivableCohort
  dealType: 'nasiya' | 'sale'
  dealId: string
  customerId: string
  customerName: string
  customerPhone: string
  deviceId: string
  deviceModel: string
  currency: 'UZS' | 'USD'
  outstanding: number
  effectiveDue: string | Date
}

interface ReceivablePageData {
  items: ReceivableItem[]
  total: number
  cohort: ReceivableCohort
  skip: number
  take: number
  dayKey: string
  currency: CurrencyContext
}

function dealHref(item: ReceivableItem) {
  return item.dealType === 'nasiya' ? `/shop/nasiyalar/${item.dealId}` : `/shop/qurilmalar/${item.deviceId}`
}

function amountText(item: ReceivableItem, currency: CurrencyContext) {
  return formatUserFacingMoney({
    amount: item.outstanding,
    amountCurrency: item.currency,
    displayCurrency: currency.currency,
    rate: currency.usdUzsRate,
  })
}

export default function ReceivablesClient({ initialData }: { initialData: ReceivablePageData }) {
  const { can } = useShopAccess()
  const scope = useAuthenticatedQueryScope()
  const queryClient = useQueryClient()
  const [cohort, setCohort] = useState<ReceivableCohort>(initialData.cohort)
  const [skip, setSkip] = useState(initialData.skip)
  const queryKey = queryKeys.list(scope, 'overdue', {
    view: 'receivables',
    cohort,
    skip,
    take: initialData.take,
  })
  const fetchPage = useCallback(async (nextCohort: ReceivableCohort, nextSkip: number, signal?: AbortSignal) => {
    const params = new URLSearchParams({
      cohort: nextCohort,
      skip: String(nextSkip),
      take: String(initialData.take),
    })
    const response = await fetch(`/api/receivables?${params.toString()}`, { signal, cache: 'no-store' })
    const json = await response.json() as { success: boolean; data?: ReceivablePageData; error?: string }
    if (!response.ok || !json.success || !json.data) throw new Error(json.error || "To'lovlar yuklanmadi")
    return json.data
  }, [initialData.take])
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => fetchPage(cohort, skip, signal),
    initialData: cohort === initialData.cohort && skip === initialData.skip ? initialData : undefined,
    placeholderData: keepPreviousData,
  })
  const data = query.data ?? initialData
  const isOverdue = cohort === 'OVERDUE'
  const error = query.error instanceof Error ? query.error.message : null

  useEffect(() => {
    replaceListUrlState({ cohort, skip })
  }, [cohort, skip])

  useEffect(() => {
    const adjacent: ReceivableCohort = cohort === 'OVERDUE' ? 'DUE_TODAY' : 'OVERDUE'
    const adjacentKey = queryKeys.list(scope, 'overdue', {
      view: 'receivables',
      cohort: adjacent,
      skip: 0,
      take: initialData.take,
    })
    void queryClient.prefetchQuery({
      queryKey: adjacentKey,
      queryFn: ({ signal }) => fetchPage(adjacent, 0, signal),
      staleTime: 120_000,
    })
  }, [cohort, fetchPage, initialData.take, queryClient, scope])

  function selectCohort(next: ReceivableCohort) {
    if (next === cohort) return
    markQueryIntent('receivables')
    setCohort(next)
    setSkip(0)
  }

  function changePage(nextSkip: number) {
    markQueryIntent('receivables')
    setSkip(Math.max(0, nextSkip))
  }
  const canOpenSaleDetails = [
    'INVENTORY_VIEW',
    'SALE_VIEW',
    'SALE_CREATE',
    'SALE_EDIT',
    'SALE_PAYMENT_RECEIVE',
    'SALE_REMINDER_MANAGE',
    'SALE_RETURN_REFUND',
  ].some((permission) => can(permission as Parameters<typeof can>[0]))
  const canOpenNasiyaDetails = [
    'NASIYA_VIEW',
    'NASIYA_CREATE',
    'NASIYA_EDIT',
    'NASIYA_PAYMENT_RECEIVE',
    'NASIYA_DEFER',
    'NASIYA_REMINDER_MANAGE',
    'NASIYA_ARCHIVE',
    'NASIYA_REOPEN',
  ].some((permission) => can(permission as Parameters<typeof can>[0]))
  const canOpenDetails = (item: ReceivableItem) => (
    item.dealType === 'nasiya' ? canOpenNasiyaDetails : canOpenSaleDetails
  )

  return (
    <div className="space-y-5 p-4 sm:p-6 lg:p-8">
      <div>
        <div className="flex items-center gap-2">
          {isOverdue ? <AlertTriangle className="size-5 text-red-600" /> : <CalendarCheck2 className="size-5 text-emerald-700" />}
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900">To'lov nazorati</h1>
        </div>
        <p className="mt-1 text-sm text-zinc-500">Naqd Qarz va Nasiya bir xil sana qoidasi bo'yicha ko'rsatiladi · {data.dayKey}</p>
      </div>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="To'lov muddati filtri">
        <button
          type="button"
          role="tab"
          aria-selected={isOverdue}
          onClick={() => selectCohort('OVERDUE')}
          className={`rounded-lg border px-4 py-2 text-sm font-medium ${isOverdue ? 'border-red-300 bg-red-50 text-red-800' : 'border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50'}`}
        >
          Muddati o'tgan
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={!isOverdue}
          onClick={() => selectCohort('DUE_TODAY')}
          className={`rounded-lg border px-4 py-2 text-sm font-medium ${!isOverdue ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50'}`}
        >
          Bugun to'lanadi
        </button>
      </div>

      <QueryActivity
        isFetching={query.isFetching}
        isInitialLoading={query.isPending && !query.data}
        error={error}
        onRetry={() => { markQueryIntent('receivables'); void query.refetch() }}
        label="To‘lovlar yangilanmoqda"
        metricId="receivables"
      >

      {!error && data.items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-300 bg-white px-6 py-12 text-center">
          <h2 className="text-base font-semibold text-zinc-900">{isOverdue ? "Muddati o'tgan to'lov yo'q" : "Bugungi to'lov yo'q"}</h2>
          <p className="mt-2 text-sm text-zinc-500">To'lov yoki muddat o'zgarsa, ro'yxat faqat tegishli ma'lumotlarni yangilaydi.</p>
        </div>
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-lg border border-zinc-200 bg-white md:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-zinc-200 bg-zinc-50 text-xs text-zinc-600">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">Mijoz</th>
                  <th scope="col" className="px-4 py-3 font-medium">Qurilma / tur</th>
                  <th scope="col" className="px-4 py-3 font-medium">Muddat</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Qoldiq</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {data.items.map((item) => (
                  <tr key={`${item.cohort}:${item.dealType}:${item.dealId}`} className={canOpenDetails(item) ? 'relative transition-colors hover:bg-zinc-50 focus-within:bg-zinc-50' : undefined}>
                    <td className="px-4 py-3">
                      {canOpenDetails(item) ? (
                        <StretchedLink href={dealHref(item)} className="font-medium text-zinc-900">
                          {item.customerName}
                          <span className="sr-only"> — {item.dealType === 'nasiya' ? 'Nasiya' : 'Qarz'} tafsilotlarini ochish</span>
                        </StretchedLink>
                      ) : (
                        <span className="font-medium text-zinc-900">{item.customerName}</span>
                      )}
                      <div className="text-xs text-zinc-500">{item.customerPhone}</div>
                    </td>
                    <td className="px-4 py-3 text-zinc-700">
                      <div>{item.deviceModel}</div>
                      <Badge variant="outline" className="mt-1 rounded text-[10px]">{item.dealType === 'nasiya' ? 'Nasiya' : 'Qarz'}</Badge>
                    </td>
                    <td className={isOverdue ? 'px-4 py-3 font-medium text-red-700' : 'px-4 py-3 font-medium text-emerald-700'}>{uzDate(item.effectiveDue)}</td>
                    <td className="px-4 py-3 text-right font-semibold text-zinc-900">{amountText(item, data.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid gap-3 md:hidden">
            {data.items.map((item) => (
              <Card key={`${item.cohort}:${item.dealType}:${item.dealId}`} className={canOpenDetails(item) ? 'relative rounded-lg transition-colors hover:bg-zinc-50 focus-within:ring-2 focus-within:ring-zinc-900' : 'rounded-lg'}>
                {canOpenDetails(item) && (
                  <StretchedLink href={dealHref(item)} className="absolute inset-0 z-0">
                    <span className="sr-only">{item.customerName} — {item.dealType === 'nasiya' ? 'Nasiya' : 'Qarz'} tafsilotlarini ochish</span>
                  </StretchedLink>
                )}
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-3">
                    <CardTitle className="text-base">{item.customerName}</CardTitle>
                    <Badge variant="outline" className="rounded">{item.dealType === 'nasiya' ? 'Nasiya' : 'Qarz'}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div className="text-zinc-500">{item.customerPhone} · {item.deviceModel}</div>
                  <div className="flex items-center justify-between gap-3">
                    <span className={isOverdue ? 'font-medium text-red-700' : 'font-medium text-emerald-700'}>{uzDate(item.effectiveDue)}</span>
                    <span className="font-semibold text-zinc-900">{amountText(item, data.currency)}</span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}

      {data.total > data.take && (
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-zinc-500">{data.skip + 1}–{Math.min(data.skip + data.take, data.total)} / {data.total}</span>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={skip === 0 || query.isFetching}
              onClick={() => changePage(skip - data.take)}
            >
              <ChevronLeft /> Oldingi
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={skip + data.take >= data.total || query.isFetching}
              onClick={() => changePage(skip + data.take)}
            >
              Keyingi <ChevronRight />
            </Button>
          </div>
        </div>
      )}
      </QueryActivity>
    </div>
  )
}
