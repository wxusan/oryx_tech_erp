'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { QueryActivity } from '@/components/query-activity'
import { formatUzPhoneDisplay } from '@/lib/phone'
import { uzDate } from '@/lib/dates'
import { formatUserFacingMoney } from '@/lib/currency'
import { useShopAccess } from '@/components/shop/shop-access-context'
import { queryKeys } from '@/lib/query-keys'
import { useAuthenticatedQueryScope } from '@/components/query-scope-context'
import { replaceListUrlState } from '@/lib/list-url-state'
import { markQueryIntent } from '@/lib/client-performance'
import type { SalesListPage } from '@/lib/sales-list-contract'
import {
  HighlightedText,
  SearchEvidence,
  searchEvidenceFor,
  type SearchEvidenceCarrier,
} from '@/components/highlighted-text'

const DEBOUNCE_MS = 275
type SalesItem = SalesListPage['items'][number] & SearchEvidenceCarrier
type SalesPayload = Omit<SalesListPage, 'items'> & {
  items: SalesItem[]
  matchEvidenceById?: unknown
}

export default function SalesWorkQueue({
  initialData,
  initialPage,
}: {
  initialData: SalesListPage
  initialPage: number
}) {
  const { memberKind } = useShopAccess()
  const scope = useAuthenticatedQueryScope()
  const showProfit = memberKind === 'SHOP_OWNER'
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [page, setPage] = useState(initialPage)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const next = search.trim()
      setDebouncedSearch(next)
      setPage(1)
    }, DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [search])

  useEffect(() => {
    replaceListUrlState({ q: null, page })
  }, [page])

  const skip = (page - 1) * initialData.take
  const query = useQuery({
    queryKey: queryKeys.list(scope, 'sales', {
      search: debouncedSearch,
      skip,
      take: initialData.take,
      sort: 'createdAt-desc',
    }),
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({
        skip: String(skip),
        take: String(initialData.take),
      })
      if (debouncedSearch) params.set('search', debouncedSearch)
      const response = await fetch(`/api/sales?${params.toString()}`, { signal, cache: 'no-store' })
      const json = await response.json() as { success?: boolean; data?: SalesPayload; error?: string }
      if (!response.ok || !json.success || !json.data) throw new Error(json.error || 'Sotuvlar yuklanmadi')
      return json.data
    },
    initialData: !debouncedSearch && page === initialPage ? initialData as SalesPayload : undefined,
    placeholderData: keepPreviousData,
  })
  const data: SalesPayload = query.data ?? (initialData as SalesPayload)
  const error = query.error instanceof Error ? query.error.message : null
  const searchPending = search.trim() !== debouncedSearch || query.isFetching
  const highlightQuery = search.trim() === debouncedSearch && !query.isPlaceholderData
    ? debouncedSearch
    : ''

  function changePage(nextPage: number) {
    markQueryIntent('sales')
    setPage(Math.max(1, nextPage))
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
      <div>
        <h1 className="text-xl font-bold text-zinc-900">Sotuvlar</h1>
        <p className="mt-1 text-sm text-zinc-500">Naqd va qarz sotuvlar</p>
      </div>
      <div className="max-w-xl">
        <Input
          aria-label="Sotuvlar qidiruvi"
          value={search}
          onChange={(event) => {
            markQueryIntent('sales')
            setSearch(event.target.value)
          }}
          placeholder="Model, IMEI, mijoz yoki telefon"
          autoComplete="off"
        />
        <p className="mt-1 min-h-4 text-xs text-zinc-400" aria-live="polite">
          {searchPending ? 'Qidiruv yangilanmoqda…' : 'Natijalar avtomatik yangilanadi'}
        </p>
      </div>

      <QueryActivity
        isFetching={query.isFetching}
        isInitialLoading={query.isPending && !query.data}
        error={error}
        onRetry={() => { markQueryIntent('sales'); void query.refetch() }}
        label="Sotuvlar yangilanmoqda"
        metricId="sales"
      >
        <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-left text-xs text-zinc-500"><tr><th className="px-4 py-3">Qurilma</th><th className="px-4 py-3">Mijoz</th><th className="px-4 py-3">Sotuv</th>{showProfit && <th className="px-4 py-3">Foyda</th>}<th className="px-4 py-3">Qoldiq</th><th className="px-4 py-3">Muddat</th><th className="px-4 py-3">Eslatma</th><th className="px-4 py-3"><span className="sr-only">Amal</span></th></tr></thead>
            <tbody>
              {query.isPending && !query.data ? (
                <tr><td colSpan={showProfit ? 8 : 7} className="p-8 text-center text-zinc-500">Yuklanmoqda...</td></tr>
              ) : data.items.length ? data.items.map((sale) => (
                <tr key={sale.id} className="border-b border-zinc-100 last:border-0">
                  <td className="px-4 py-3">
                    <div className="font-medium text-zinc-900"><HighlightedText value={sale.device.model} query={highlightQuery} mode="text" /></div>
                    <div className="font-mono text-xs text-zinc-400"><HighlightedText value={sale.device.imei} query={highlightQuery} mode="identifier" /></div>
                    <SearchEvidence evidence={searchEvidenceFor(sale.id, sale, data as SalesPayload)} query={highlightQuery} />
                  </td>
                  <td className="px-4 py-3"><div><HighlightedText value={sale.customer.name} query={highlightQuery} mode="text" /></div><div className="text-xs text-zinc-500"><HighlightedText value={formatUzPhoneDisplay(sale.customer.phone)} query={highlightQuery} mode="identifier" /></div></td>
                  <td className="px-4 py-3 font-medium">{formatUserFacingMoney({ amount: sale.contractSalePrice, amountCurrency: sale.contractCurrency, displayCurrency: sale.contractCurrency })}</td>
                  {showProfit && <td className="px-4 py-3 font-medium text-emerald-600">{sale.contractProfit == null ? '—' : formatUserFacingMoney({ amount: sale.contractProfit, amountCurrency: sale.contractCurrency, displayCurrency: sale.contractCurrency })}</td>}
                  <td className="px-4 py-3 font-medium">{formatUserFacingMoney({ amount: sale.contractRemainingAmount, amountCurrency: sale.contractCurrency, displayCurrency: sale.contractCurrency })}</td>
                  <td className="px-4 py-3 text-zinc-600">{sale.dueDate ? uzDate(sale.dueDate) : '—'}</td>
                  <td className="px-4 py-3 text-zinc-600">{sale.reminderEnabled ? 'Yoqilgan' : "O'chirilgan"}</td>
                  <td className="px-4 py-3 text-right"><Button render={<Link href={`/shop/qurilmalar/${sale.device.id}?purpose=sale`} />} nativeButton={false} variant="outline" size="sm">Ochish</Button></td>
                </tr>
              )) : (
                <tr><td colSpan={showProfit ? 8 : 7} className="p-8 text-center text-zinc-500">Sotuv topilmadi</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex items-center justify-end gap-2">
          <Button variant="outline" disabled={page === 1 || query.isFetching} onClick={() => changePage(page - 1)}>Oldingi</Button>
          <span className="min-w-16 text-center text-xs text-zinc-500">{page}-sahifa</span>
          <Button variant="outline" disabled={!data.hasNext || query.isFetching} onClick={() => changePage(page + 1)}>Keyingi</Button>
        </div>
      </QueryActivity>
    </div>
  )
}
