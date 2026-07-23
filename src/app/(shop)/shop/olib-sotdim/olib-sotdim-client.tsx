'use client'

import { useEffect, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { StretchedLink } from '@/components/ui/stretched-link'
import { Input } from '@/components/ui/input'
import { DateInput } from '@/components/ui/date-input'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { displayImei } from '@/lib/device-display'
import { uzDate } from '@/lib/dates'
import { formatUserFacingMoney } from '@/lib/currency'
import { useShopCurrency } from '@/lib/use-shop-currency'
import { formatUzPhoneDisplay } from '@/lib/phone'
import { DeviceConditionBadge } from '@/components/shop/device-condition-badge'
import { tashkentTodayInputValue } from '@/lib/timezone'
import { commitNavigationMutation } from '@/lib/client-events'
import { replaceListUrlState } from '@/lib/list-url-state'
import { queryKeys } from '@/lib/query-keys'
import { useAuthenticatedQueryScope } from '@/components/query-scope-context'
import type { PaymentMethod, SupplierPayableStatus } from '@/lib/domain-types'
import { useShopAccess } from '@/components/shop/shop-access-context'
import { QueryActivity } from '@/components/query-activity'
import { AsyncButton } from '@/components/ui/async-button'
import { markQueryIntent } from '@/lib/client-performance'
import {
  HighlightedText,
  SearchEvidence,
  searchEvidenceFor,
  type SearchEvidenceCarrier,
} from '@/components/highlighted-text'
import { useLogicalCommandIdempotency } from '@/lib/use-logical-command-idempotency'

type PayableStatus = SupplierPayableStatus

const statusLabels: Record<PayableStatus, string> = {
  PENDING: 'To‘lanmagan',
  PARTIAL: 'Qisman to‘langan',
  PAID: 'To‘langan',
  CANCELLED: 'Bekor qilingan',
  OVERDUE: 'To‘lov muddati o‘tgan',
}

const statusStyles: Record<PayableStatus, string> = {
  PENDING: 'bg-zinc-100 text-zinc-700',
  PARTIAL: 'bg-amber-100 text-amber-800',
  PAID: 'bg-emerald-100 text-emerald-700',
  CANCELLED: 'bg-zinc-200 text-zinc-500',
  OVERDUE: 'bg-red-100 text-red-700',
}

interface OlibSotdimRow extends SearchEvidenceCarrier {
  id: string
  amount: number
  paidAmount: number
  remainingAmount: number
  contractCurrency: 'UZS' | 'USD'
  status: PayableStatus
  dueDate: string
  paidAt: string | null
  supplierName: string
  supplierPhone: string
  supplierLocation: string | null
  createdAt: string
  device: {
    id: string
    model: string
    imei: string
    secondaryImei: string | null
    color: string | null
    storage: string | null
    storageDisplay: string | null
    conditionLabel: string
    /** Owner-only cost fields are omitted for a staff response. */
    purchasePrice?: number
    purchaseCurrency?: 'UZS' | 'USD'
  }
  customer: { id: string; name: string; phone: string } | null
  customerOutcome: {
    type: 'SALE' | 'NASIYA'
    id: string
    total: number
    remaining: number
    contractCurrency: 'UZS' | 'USD'
    months?: number
    monthlyPayment?: number
  } | null
  /** Owner-only margin, omitted for staff. */
  profit?: number | null
}

interface OlibSotdimPayload extends SearchEvidenceCarrier {
  items: OlibSotdimRow[]
  total: number
  matchEvidenceById?: unknown
}

export default function OlibSotdimClient({ initialSearch, initialPage }: { initialSearch: string; initialPage: number }) {
  const { currency } = useShopCurrency()
  const scope = useAuthenticatedQueryScope()
  const { can, memberKind } = useShopAccess()
  const canCreate = can('OLIB_CREATE')
  const canReceivePayment = can('SUPPLIER_PAYMENT_RECORD') || can('SUPPLIER_PAYMENT_MARK_PAID')
  const canViewDevice = can('INVENTORY_VIEW')
  const canSeeOwnerFinancials = memberKind === 'SHOP_OWNER'
  const [search, setSearch] = useState(initialSearch)
  const [committedSearch, setCommittedSearch] = useState(initialSearch)
  const [page, setPage] = useState(initialPage)
  const [payFor, setPayFor] = useState<OlibSotdimRow | null>(null)
  const [payMethod, setPayMethod] = useState<PaymentMethod | ''>('')
  const [payDate, setPayDate] = useState('')
  const [payNote, setPayNote] = useState('')
  const [payError, setPayError] = useState('')
  const [paySubmitting, setPaySubmitting] = useState(false)
  const payCommand = useLogicalCommandIdempotency()

  useEffect(() => {
    if (search.trim() === committedSearch) return
    const timer = window.setTimeout(() => {
      markQueryIntent('olib-sotdim-list')
      setCommittedSearch(search.trim())
      setPage(0)
    }, 275)
    return () => window.clearTimeout(timer)
  }, [committedSearch, search])

  function fmt(n: number, valueCurrency: 'UZS' | 'USD' = currency.currency) {
    return formatUserFacingMoney({ amount: n, amountCurrency: valueCurrency, displayCurrency: currency.currency, rate: currency.usdUzsRate })
  }

  const pageSize = 25

  const rowsQuery = useQuery({
    queryKey: queryKeys.list(scope, 'olibSotdim', {
      search: committedSearch,
      page: page + 1,
      take: pageSize,
      sort: 'createdAt-desc',
    }),
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({
        search: committedSearch,
        skip: String(page * pageSize),
        take: String(pageSize),
      })
      const response = await fetch(`/api/olib-sotdim?${params.toString()}`, { signal, cache: 'no-store' })
      const json = await response.json() as { success: boolean; data?: OlibSotdimPayload; error?: string }
      if (!response.ok || !json.success || !json.data) throw new Error(json.error || "Ro'yxat yuklanmadi")
      return json.data
    },
    placeholderData: keepPreviousData,
  })

  function load(nextPage: number) {
    markQueryIntent('olib-sotdim-list')
    replaceListUrlState({ q: committedSearch, page: nextPage + 1 })
    setPage(nextPage)
  }

  useEffect(() => {
    replaceListUrlState({ q: committedSearch, page: page + 1 })
  }, [committedSearch, page])

  const rows = rowsQuery.data?.items ?? []
  const total = rowsQuery.data?.total ?? 0
  const loading = rowsQuery.isPending && !rowsQuery.data
  const error = rowsQuery.error instanceof Error ? rowsQuery.error.message : ''
  const highlightQuery = search.trim() === committedSearch && !rowsQuery.isPlaceholderData
    ? committedSearch
    : ''

  function openPay(row: OlibSotdimRow) {
    setPayFor(row)
    setPayMethod('')
    setPayDate(tashkentTodayInputValue())
    setPayNote('')
    setPayError('')
  }

  async function handleMarkPaid() {
    if (!payFor || !payMethod || paySubmitting) return
    setPaySubmitting(true)
    setPayError('')
    try {
      const payload = {
        paymentMethod: payMethod,
        paidAt: payDate || undefined,
        note: payNote.trim() || undefined,
      }
      const res = await fetch(`/api/olib-sotdim/${payFor.id}/pay`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': payCommand.keyFor({ supplierPayableId: payFor.id, payload }),
        },
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (!res.ok || !json.success) {
        payCommand.rejected(res.status)
        throw new Error(json.error || "To'lovni saqlashda xatolik")
      }
      payCommand.committed()
      await commitNavigationMutation({
        kind: 'olibSotdim.paymentRecorded',
        deviceId: payFor.device.id,
      })
      setPayFor(null)
      void rowsQuery.refetch()
    } catch (err) {
      setPayError(err instanceof Error ? err.message : "To'lovni saqlashda xatolik")
    } finally {
      setPaySubmitting(false)
    }
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-zinc-900">Olib-sotdim</h1>
          <p className="text-sm text-zinc-500 mt-0.5">Boshqa do&apos;kondan olib sotilgan qurilmalar va yetkazib beruvchi qarzlari</p>
        </div>
        {canCreate && (
          <Button
            render={<Link href="/shop/olib-sotdim/new" />}
            nativeButton={false}
            size="lg"
            className="bg-zinc-900 text-white hover:bg-zinc-800"
          >
            + Olib-sotdim
          </Button>
        )}
      </div>

      <div className="max-w-md">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Yetkazib beruvchi, mijoz, model yoki IMEI bo'yicha qidirish..."
          className="h-9 text-sm border-zinc-200 rounded"
        />
      </div>

      <div className="flex items-center justify-between text-xs text-zinc-500">
        <span>{total} ta operatsiya</span>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={loading || page === 0} onClick={() => load(page - 1)}>
            Oldingi
          </Button>
          <span>{page + 1} / {Math.max(1, Math.ceil(total / pageSize))}</span>
          <Button variant="outline" size="sm" disabled={loading || (page + 1) * pageSize >= total} onClick={() => load(page + 1)}>
            Keyingi
          </Button>
        </div>
      </div>

      <QueryActivity
        isFetching={rowsQuery.isFetching}
        isInitialLoading={loading}
        error={error}
        onRetry={() => void rowsQuery.refetch()}
        metricId="olib-sotdim-list"
      >
      <div className="space-y-3 md:hidden">
        {loading ? (
          <div className="rounded border border-zinc-200 bg-white px-4 py-8 text-center text-sm text-zinc-400">Yuklanmoqda...</div>
        ) : rows.length === 0 ? (
          <div className="rounded border border-zinc-200 bg-white px-4 py-8 text-center text-sm text-zinc-400">Operatsiya topilmadi</div>
        ) : rows.map((row) => (
          <article key={row.id} className="relative space-y-3 rounded-lg border border-zinc-200 bg-white p-4 transition-colors hover:bg-zinc-50">
            {canViewDevice && (
              <StretchedLink
                href={`/shop/qurilmalar/${row.device.id}`}
                aria-label={`${row.device.model} qurilmasi ma'lumotlarini ochish`}
              >
                <span className="sr-only">{row.device.model} qurilmasi ma&apos;lumotlarini ochish</span>
              </StretchedLink>
            )}
            <div className="pointer-events-none relative z-10 flex items-start justify-between gap-3">
              <div>
                <div className="font-medium text-zinc-900"><HighlightedText value={row.device.model} query={highlightQuery} mode="text" /></div>
                <div className="text-xs text-zinc-500"><HighlightedText value={row.device.storageDisplay || row.device.storage || '—'} query={highlightQuery} mode="auto" /></div>
                <DeviceConditionBadge label={row.device.conditionLabel} className="mt-1" />
                <div className="font-mono text-xs text-zinc-400">
                  Asosiy IMEI: <HighlightedText value={displayImei(row.device.imei)} query={highlightQuery} mode="identifier" />
                  {row.device.secondaryImei && <> · Qo‘shimcha IMEI: <HighlightedText value={displayImei(row.device.secondaryImei)} query={highlightQuery} mode="identifier" /></>}
                </div>
                <SearchEvidence evidence={searchEvidenceFor(row.id, row, rowsQuery.data)} query={highlightQuery} />
              </div>
              <span className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${statusStyles[row.status]}`}>
                {statusLabels[row.status]}
              </span>
            </div>
            <dl className="pointer-events-none relative z-10 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <div><dt className="text-zinc-400">Yetkazib beruvchi</dt><dd className="mt-0.5 text-zinc-800"><HighlightedText value={row.supplierName} query={highlightQuery} mode="text" /></dd><dd className="text-zinc-500"><HighlightedText value={formatUzPhoneDisplay(row.supplierPhone)} query={highlightQuery} mode="identifier" /></dd></div>
              <div><dt className="text-zinc-400">Mijoz</dt><dd className="mt-0.5 text-zinc-800"><HighlightedText value={row.customer?.name ?? '—'} query={highlightQuery} mode="text" /></dd>{row.customer?.phone && <dd className="text-zinc-500"><HighlightedText value={formatUzPhoneDisplay(row.customer.phone)} query={highlightQuery} mode="identifier" /></dd>}</div>
              {canSeeOwnerFinancials && row.device.purchasePrice != null && row.device.purchaseCurrency && (
                <div><dt className="text-zinc-400">Olingan</dt><dd className="mt-0.5 font-medium text-zinc-900">{fmt(row.device.purchasePrice, row.device.purchaseCurrency)}</dd></div>
              )}
              {canSeeOwnerFinancials && row.customerOutcome && (
                <div><dt className="text-zinc-400">{row.customerOutcome.type === 'NASIYA' ? 'Nasiya jami' : 'Sotilgan'}</dt><dd className="mt-0.5 font-medium text-zinc-900">{fmt(row.customerOutcome.total, row.customerOutcome.contractCurrency)}</dd></div>
              )}
              {canSeeOwnerFinancials && row.profit != null && (
                <div><dt className="text-zinc-400">Farq</dt><dd className={`mt-0.5 font-medium ${row.profit < 0 ? 'text-red-600' : 'text-emerald-700'}`}>{fmt(row.profit, row.contractCurrency)}</dd></div>
              )}
              <div><dt className="text-zinc-400">Sana</dt><dd className="mt-0.5 text-zinc-700">{uzDate(row.createdAt)}</dd></div>
            </dl>
            {canReceivePayment && (row.status === 'PENDING' || row.status === 'PARTIAL' || row.status === 'OVERDUE') && (
              <div className="relative z-10">
                <Button variant="outline" className="h-10 w-full" onClick={() => openPay(row)}>
                  To&apos;landi deb belgilash
                </Button>
              </div>
            )}
          </article>
        ))}
      </div>

      <div className="hidden border border-zinc-200 rounded overflow-x-auto md:block">
        <table className="min-w-[1100px] w-full text-sm">
          <thead className="bg-zinc-50 border-b border-zinc-200">
            <tr>
              {[
                'Sana',
                'Qurilma',
                'Yetkazib beruvchi',
                'Mijoz',
                ...(canSeeOwnerFinancials ? ['Olingan narx'] : []),
                ...(canSeeOwnerFinancials ? ['Sotilgan narx'] : []),
                ...(canSeeOwnerFinancials ? ['Farq'] : []),
                'Holat',
                '',
              ].map((h) => (
                <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-zinc-500 uppercase tracking-wide">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={canSeeOwnerFinancials ? 9 : 6} className="px-4 py-8 text-center text-zinc-400 text-sm">Yuklanmoqda...</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={canSeeOwnerFinancials ? 9 : 6} className="px-4 py-8 text-center text-zinc-400 text-sm">Operatsiya topilmadi</td></tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="relative border-b border-zinc-100 last:border-0 hover:bg-zinc-50">
                  <td className="px-4 py-3 text-zinc-500">
                    {canViewDevice ? (
                      <StretchedLink
                        href={`/shop/qurilmalar/${row.device.id}`}
                        aria-label={`${row.device.model} qurilmasi ma'lumotlarini ochish`}
                        className="text-zinc-500 hover:underline"
                      >
                        {uzDate(row.createdAt)}
                      </StretchedLink>
                    ) : uzDate(row.createdAt)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-zinc-900"><HighlightedText value={row.device.model} query={highlightQuery} mode="text" /></div>
                    <div className="text-xs text-zinc-500"><HighlightedText value={row.device.storageDisplay || row.device.storage || '—'} query={highlightQuery} mode="auto" /></div>
                    <DeviceConditionBadge label={row.device.conditionLabel} className="mt-1" />
                    <div className="text-xs text-zinc-400 font-mono">
                      Asosiy IMEI: <HighlightedText value={displayImei(row.device.imei)} query={highlightQuery} mode="identifier" />
                      {row.device.secondaryImei && <> · Qo‘shimcha IMEI: <HighlightedText value={displayImei(row.device.secondaryImei)} query={highlightQuery} mode="identifier" /></>}
                    </div>
                    <SearchEvidence evidence={searchEvidenceFor(row.id, row, rowsQuery.data)} query={highlightQuery} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-zinc-900"><HighlightedText value={row.supplierName} query={highlightQuery} mode="text" /></div>
                    <div className="text-xs text-zinc-500"><HighlightedText value={formatUzPhoneDisplay(row.supplierPhone)} query={highlightQuery} mode="identifier" /></div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-zinc-900"><HighlightedText value={row.customer?.name ?? '—'} query={highlightQuery} mode="text" /></div>
                    <div className="text-xs text-zinc-500"><HighlightedText value={row.customer ? formatUzPhoneDisplay(row.customer.phone) : '—'} query={highlightQuery} mode="identifier" /></div>
                  </td>
                  {canSeeOwnerFinancials && (
                    <td className="px-4 py-3 text-zinc-900 font-medium">
                      {row.device.purchasePrice != null && row.device.purchaseCurrency
                        ? fmt(row.device.purchasePrice, row.device.purchaseCurrency)
                        : '—'}
                    </td>
                  )}
                  {canSeeOwnerFinancials && (
                    <td className="px-4 py-3 text-zinc-900 font-medium">
                      {row.customerOutcome
                        ? fmt(row.customerOutcome.total, row.customerOutcome.contractCurrency)
                        : '—'}
                    </td>
                  )}
                  {canSeeOwnerFinancials && (
                    <td className="px-4 py-3">
                      {row.profit != null && (
                        <span className={row.profit < 0 ? 'text-red-600 font-medium' : 'text-emerald-700 font-medium'}>{fmt(row.profit, row.contractCurrency)}</span>
                      )}
                      {row.status !== 'PAID' && <div className="text-[10px] text-amber-600 mt-0.5">{statusLabels[row.status]}</div>}
                    </td>
                  )}
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${statusStyles[row.status]}`}>
                      {statusLabels[row.status]}
                    </span>
                  </td>
                  <td className="relative z-10 px-4 py-3">
                    {canReceivePayment && (row.status === 'PENDING' || row.status === 'PARTIAL' || row.status === 'OVERDUE') && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => openPay(row)}
                        className="text-zinc-700"
                      >
                        To&apos;landi deb belgilash
                      </Button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      </QueryActivity>

      <Dialog open={!!payFor} onOpenChange={(open) => !open && !paySubmitting && setPayFor(null)}>
        <DialogContent className="max-w-md rounded">
          <DialogHeader>
            <DialogTitle>Yetkazib beruvchiga to&apos;lovni qayd etish</DialogTitle>
          </DialogHeader>
          {payFor && (
            <div className="space-y-3">
              <div className="text-sm text-zinc-600">
                {payFor.supplierName} · qolgan {fmt(payFor.remainingAmount, payFor.contractCurrency)}
              </div>
              {payError && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{payError}</div>}
              <div>
                <label htmlFor="supplier-payment-method" className="block text-xs font-medium text-zinc-700 mb-1.5">To&apos;lov usuli</label>
                <Select value={payMethod} onValueChange={(v) => v && setPayMethod(v as PaymentMethod)}>
                  <SelectTrigger id="supplier-payment-method" className="h-9 text-sm border-zinc-200 rounded">
                    <SelectValue placeholder="Tanlang" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CASH">Naqd pul</SelectItem>
                    <SelectItem value="CARD">Karta orqali</SelectItem>
                    <SelectItem value="TRANSFER">Pul o‘tkazmasi</SelectItem>
                    <SelectItem value="OTHER">Boshqa</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label htmlFor="supplier-payment-date" className="block text-xs font-medium text-zinc-700 mb-1.5">Sana</label>
                <DateInput id="supplier-payment-date" value={payDate} onValueChange={setPayDate} className="h-9 text-sm border-zinc-200 rounded" />
              </div>
              <div>
                <label htmlFor="supplier-payment-note" className="block text-xs font-medium text-zinc-700 mb-1.5">Izoh</label>
                <Textarea id="supplier-payment-note" value={payNote} onChange={(e) => setPayNote(e.target.value)} className="text-sm border-zinc-200 rounded min-h-[60px]" />
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" disabled={paySubmitting} onClick={() => setPayFor(null)} className="border-zinc-200 text-zinc-700 rounded">
              Bekor qilish
            </Button>
            <AsyncButton
              pending={paySubmitting}
              pendingLabel="Saqlanmoqda..."
              disabled={!payMethod}
              onClick={handleMarkPaid}
              className="bg-zinc-900 text-white rounded"
            >
              Saqlash
            </AsyncButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
