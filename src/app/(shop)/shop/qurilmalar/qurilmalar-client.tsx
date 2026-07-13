'use client'

import { memo, useEffect, useMemo, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { exportUrl } from '@/lib/export-url'
import { uzDate } from '@/lib/dates'
import { displayImei } from '@/lib/device-display'
import { formatMoneyByCurrency, type CurrencyContext } from '@/lib/currency'
import { formatDisplayMoneyFromContract } from '@/lib/nasiya-contract'
import { IntentPrefetchLink } from '@/components/intent-prefetch-link'
import { DeviceConditionBadge } from '@/components/shop/device-condition-badge'
import { replaceListUrlState } from '@/lib/list-url-state'
import type { DeviceListItem, DeviceListPage, DeviceStatus } from '@/lib/device-list-contract'
import { queryKeys, type DeviceListQuery } from '@/lib/query-keys'
import { useAuthenticatedQueryScope } from '@/components/query-scope-context'
import { adoptIncrementalSnapshotCursor, requestIncrementalSync } from '@/lib/client-sync-runtime'

type DisplayStatus = 'Omborda' | 'Sotilgan' | 'Qarz' | 'Nasiyada' | 'Qaytarilgan (eski holat)' | "O'chirilgan"
type Device = DeviceListItem

interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
}

const statusMap: Record<DeviceStatus, DisplayStatus> = {
  IN_STOCK: 'Omborda',
  SOLD_CASH: 'Sotilgan',
  SOLD_DEBT: 'Qarz',
  SOLD_NASIYA: 'Nasiyada',
  RETURNED: 'Qaytarilgan (eski holat)',
  DELETED: "O'chirilgan",
}

const filterTabs: { label: string; value: DeviceStatus | 'Barchasi' }[] = [
  { label: 'Barchasi', value: 'Barchasi' },
  { label: 'Omborda', value: 'IN_STOCK' },
  { label: 'Sotilgan', value: 'SOLD_CASH' },
  { label: 'Qarz', value: 'SOLD_DEBT' },
  { label: 'Nasiyada', value: 'SOLD_NASIYA' },
  { label: 'Qaytarilgan (eski)', value: 'RETURNED' },
]

function StatusBadge({ status }: { status: DeviceStatus }) {
  const label = statusMap[status]
  const styles: Record<DisplayStatus, string> = {
    'Omborda': 'bg-zinc-100 text-zinc-700',
    'Sotilgan': 'bg-zinc-900 text-white',
    'Qarz': 'bg-amber-100 text-amber-800',
    'Nasiyada': 'bg-zinc-800 text-zinc-100',
    'Qaytarilgan (eski holat)': 'bg-blue-100 text-blue-700',
    "O'chirilgan": 'bg-zinc-200 text-zinc-500',
  }
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${styles[label]}`}>
      {label}
    </span>
  )
}

/** Sold price — converts from the deal's own contract currency, never the
 * legacy UZS snapshot re-derived through today's rate (see
 * docs/currency-accounting-model.md). Shared by the desktop table and the
 * mobile card view. */
function SoldPriceValue({ d, currency }: { d: Device; currency: CurrencyContext }) {
  if (!d.saleInfo) return <>—</>
  return <>{formatDisplayMoneyFromContract(d.saleInfo.contractSoldPrice, d.saleInfo.contractCurrency, currency.currency, currency.usdUzsRate)}</>
}

/** Profit ("Farq") — prefers contractProfit over the legacy UZS profit
 * field, falling back only when a USD contract has no creation rate on
 * record. Shared by the desktop table and the mobile card view. */
function ProfitValue({ d, currency }: { d: Device; currency: CurrencyContext }) {
  if (!d.saleInfo) return <>—</>
  if (d.saleInfo.returned) return <span className="text-xs text-blue-700">Qaytarilgan</span>
  if (d.saleInfo.contractProfit != null) {
    return (
      <span className={d.saleInfo.contractProfit < 0 ? 'text-red-600 font-medium' : 'text-emerald-700 font-medium'}>
        {formatDisplayMoneyFromContract(d.saleInfo.contractProfit, d.saleInfo.contractCurrency, currency.currency, currency.usdUzsRate)}
      </span>
    )
  }
  return (
    <span className={d.saleInfo.profit != null && d.saleInfo.profit < 0 ? 'text-red-600 font-medium' : 'text-emerald-700 font-medium'}>
      {formatMoneyByCurrency(d.saleInfo.profit ?? 0, currency.currency, currency.usdUzsRate)}
    </span>
  )
}

const DeviceTableRow = memo(function DeviceTableRow({
  device: d,
  currency,
}: {
  device: Device
  currency: CurrencyContext
}) {
  return (
    <tr className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50">
      <td className="px-4 py-3 font-medium text-zinc-900"><div>{d.model}</div><DeviceConditionBadge label={d.conditionLabel} className="mt-1" /></td>
      <td className="px-4 py-3 text-zinc-600">{d.color ?? '—'}</td>
      <td className="px-4 py-3 text-zinc-600">{d.storageDisplay || '—'}</td>
      <td className="px-4 py-3 text-zinc-600">{d.batteryHealth != null ? `${d.batteryHealth}%` : '—'}</td>
      <td className="px-4 py-3 font-medium text-zinc-900">
        {formatMoneyByCurrency(d.purchasePrice, currency.currency, currency.usdUzsRate)}
      </td>
      <td className="px-4 py-3 font-mono text-xs text-zinc-400"><div>{displayImei(d.primaryImei)}</div>{d.secondaryImei && <div className="mt-0.5">{displayImei(d.secondaryImei)}</div>}</td>
      <td className="px-4 py-3"><StatusBadge status={d.status} /></td>
      <td className="px-4 py-3 font-medium text-zinc-900">
        {d.saleInfo ? (
          <>
            <div><SoldPriceValue d={d} currency={currency} /></div>
            {d.status === 'SOLD_DEBT' && d.saleInfo.contractRemainingAmount != null && (
              <div className="mt-0.5 text-xs font-medium text-amber-800">
                Qarz: {formatDisplayMoneyFromContract(d.saleInfo.contractRemainingAmount, d.saleInfo.contractCurrency, currency.currency, currency.usdUzsRate)}
              </div>
            )}
          </>
        ) : '—'}
      </td>
      <td className="px-4 py-3"><ProfitValue d={d} currency={currency} /></td>
      <td className="px-4 py-3 text-zinc-600">{d.saleInfo?.customerName ?? '—'}</td>
      <td className="px-4 py-3 text-zinc-500">{uzDate(d.createdAt)}</td>
      <td className="px-4 py-3">
        <IntentPrefetchLink
          href={`/shop/qurilmalar/${d.id}`}
          className="inline-flex rounded border border-zinc-200 px-3 py-1.5 text-xs text-zinc-700 transition-colors hover:bg-zinc-100"
        >
          Ko&apos;rish
        </IntentPrefetchLink>
      </td>
    </tr>
  )
})

const DeviceMobileCard = memo(function DeviceMobileCard({
  device: d,
  currency,
}: {
  device: Device
  currency: CurrencyContext
}) {
  return (
    <div className="space-y-2 rounded border border-zinc-200 p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-medium text-zinc-900">{d.model}</div>
          <DeviceConditionBadge label={d.conditionLabel} className="mt-1" />
          <div className="mt-0.5 font-mono text-xs text-zinc-500">{displayImei(d.primaryImei)}{d.secondaryImei && ` · ${displayImei(d.secondaryImei)}`}</div>
        </div>
        <StatusBadge status={d.status} />
      </div>
      <div className="text-xs text-zinc-500">
        {[d.color, d.storageDisplay, d.batteryHealth != null ? `${d.batteryHealth}%` : null].filter(Boolean).join(' · ') || '—'}
      </div>
      <div className="flex items-center justify-between text-xs text-zinc-600">
        <span>Kelish: {formatMoneyByCurrency(d.purchasePrice, currency.currency, currency.usdUzsRate)}</span>
        {d.saleInfo && <span>Sotuv: <SoldPriceValue d={d} currency={currency} /></span>}
      </div>
      {d.status === 'SOLD_DEBT' && d.saleInfo?.contractRemainingAmount != null && (
        <div className="text-xs font-medium text-amber-800">
          Qarz: {formatDisplayMoneyFromContract(d.saleInfo.contractRemainingAmount, d.saleInfo.contractCurrency, currency.currency, currency.usdUzsRate)}
        </div>
      )}
      {d.saleInfo && (
        <div className="flex items-center justify-between text-xs">
          <span className="text-zinc-500">{d.saleInfo.customerName ?? '—'}</span>
          <ProfitValue d={d} currency={currency} />
        </div>
      )}
      <div className="text-xs text-zinc-400">{uzDate(d.createdAt)}</div>
      <IntentPrefetchLink
        href={`/shop/qurilmalar/${d.id}`}
        className={buttonVariants({ variant: 'outline', className: 'h-8 w-full rounded border-zinc-200 text-xs' })}
      >
        Ko&apos;rish
      </IntentPrefetchLink>
    </div>
  )
})

// Item — real page/skip/take pagination (matches /api/logs' established
// envelope, and mijozlar/logs' client-fetch pattern) — replaces the old
// single unbounded-in-spirit fetch capped at a fixed ceiling.
const PER_PAGE = 25

function buildRequestKey(search: string, status: DeviceStatus | 'Barchasi', condition: 'ALL' | 'NEW' | 'USED', page: number) {
  const params = new URLSearchParams({ paginated: '1' })
  if (search.trim()) params.set('search', search.trim())
  if (status !== 'Barchasi') params.set('status', status)
  if (condition !== 'ALL') params.set('condition', condition)
  params.set('skip', String((page - 1) * PER_PAGE))
  params.set('take', String(PER_PAGE))
  return params.toString()
}

export default function QurilmalarClient({
  initialDevices,
  initialTotal,
  currency,
  initialStatus = 'Barchasi',
  initialSearch = '',
  initialPage = 1,
  initialSyncCursor,
}: {
  initialDevices: Device[]
  initialTotal: number
  currency: CurrencyContext
  initialStatus?: DeviceStatus | 'Barchasi'
  initialSearch?: string
  initialPage?: number
  initialSyncCursor: string
}) {
  const scope = useAuthenticatedQueryScope()
  const [page, setPage] = useState(initialPage)
  const [search, setSearch] = useState(initialSearch)
  const [debouncedSearch, setDebouncedSearch] = useState(initialSearch)
  const [activeStatus, setActiveStatus] = useState<DeviceStatus | 'Barchasi'>(initialStatus)
  const [condition, setCondition] = useState<'ALL' | 'NEW' | 'USED'>('ALL')
  const initialRequestKey = useMemo(
    () => buildRequestKey(initialSearch, initialStatus, 'ALL', initialPage),
    [initialPage, initialSearch, initialStatus],
  )

  useEffect(() => {
    adoptIncrementalSnapshotCursor(initialSyncCursor)
    void requestIncrementalSync()
  }, [initialSyncCursor])

  // Debounce the free-text search so typing doesn't fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  const requestKey = useMemo(
    () => buildRequestKey(debouncedSearch, activeStatus, condition, page),
    [debouncedSearch, activeStatus, condition, page],
  )

  const listQuery = useMemo<DeviceListQuery>(() => ({
    search: debouncedSearch,
    status: activeStatus,
    condition,
    page,
    take: PER_PAGE,
    sort: 'createdAt-desc',
  }), [activeStatus, condition, debouncedSearch, page])

  const devicesQuery = useQuery({
    queryKey: queryKeys.devices.list(scope, listQuery),
    queryFn: async ({ signal }) => {
      const response = await fetch(`/api/devices?${requestKey}`, { signal, cache: 'no-store' })
      const json = await response.json() as ApiResponse<DeviceListPage>
      if (!response.ok || !json.success || !json.data) {
        throw new Error(json.error || 'Qurilmalar yuklanmadi')
      }
      return json.data
    },
    initialData: requestKey === initialRequestKey
      ? { items: initialDevices, total: initialTotal, skip: (initialPage - 1) * PER_PAGE, take: PER_PAGE }
      : undefined,
    placeholderData: keepPreviousData,
  })

  useEffect(() => {
    replaceListUrlState({ q: debouncedSearch, status: activeStatus, page })
  }, [activeStatus, debouncedSearch, page])

  const devices = devicesQuery.data?.items ?? []
  const total = devicesQuery.data?.total ?? 0
  const error = devicesQuery.error instanceof Error ? devicesQuery.error.message : ''
  const loading = devicesQuery.isPending && !devicesQuery.data
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE))

  return (
    <div className="p-6 space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-zinc-900">Qurilmalar</h1>
          <p className="text-sm text-zinc-500 mt-0.5">Omboringizdagi barcha qurilmalar</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Shop-scoped devices export (session cookie auth) — entity confirmed supported by /api/export/[entity] */}
          <button
            onClick={() => {
              window.location.href = exportUrl('devices', 'xlsx')
            }}
            className="h-9 px-4 text-sm border border-zinc-200 rounded text-zinc-700 hover:bg-zinc-100 transition-colors"
          >
            Excel yuklab olish
          </button>
          <Link href="/shop/qurilmalar/new">
            <Button className="bg-zinc-900 hover:bg-zinc-800 text-white h-9 px-4 text-sm rounded">
              + Yangi qurilma
            </Button>
          </Link>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 overflow-x-auto border-b border-zinc-200">
        {filterTabs.map((tab) => (
          <button
            key={tab.value}
            onClick={() => { setActiveStatus(tab.value); setPage(1) }}
            className={`-mb-px shrink-0 border-b-2 px-3 py-2 text-sm transition-colors ${
              activeStatus === tab.value
                ? 'border-zinc-900 text-zinc-900 font-medium'
                : 'border-transparent text-zinc-500 hover:text-zinc-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} placeholder="Model, IMEI, rang, xotira yoki yetkazib beruvchi bo'yicha qidirish..." className="max-w-md h-9 text-sm border-zinc-200 rounded" />
        <Select value={condition} onValueChange={(value) => { if (value) { setCondition(value as 'ALL' | 'NEW' | 'USED'); setPage(1) } }}>
          <SelectTrigger className="h-9 w-full sm:w-40"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="ALL">Barcha holatlar</SelectItem><SelectItem value="NEW">Yangi</SelectItem><SelectItem value="USED">B/U</SelectItem></SelectContent>
        </Select>
      </div>

      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-4 py-3">{error}</div>}

      {/* Desktop table — unchanged rendering, just gated to sm: and up. */}
      <div className="hidden sm:block border border-zinc-200 rounded overflow-x-auto">
          <table className="min-w-[1180px] w-full text-sm">
            <thead className="bg-zinc-50 border-b border-zinc-200">
              <tr>
                {['Model', 'Rang', 'Xotira', 'Batareya', 'Kelish narxi', 'IMEI', 'Status', 'Sotuv narxi', 'Farq', 'Mijoz', 'Sana', ''].map((h) => (
                  <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-zinc-500 uppercase tracking-wide">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={12} className="px-4 py-8 text-center text-zinc-400 text-sm">
                    Yuklanmoqda...
                  </td>
                </tr>
              ) : devices.length === 0 ? (
                <tr>
                  <td colSpan={12} className="px-4 py-8 text-center text-zinc-400 text-sm">
                    Qurilma topilmadi
                  </td>
                </tr>
              ) : (
                devices.map((device) => (
                  <DeviceTableRow key={device.id} device={device} currency={currency} />
                ))
              )}
            </tbody>
          </table>
      </div>

      {/* Mobile card view — same data as the table, actions directly visible
          (not hidden in an overflow menu). */}
      <div className="sm:hidden space-y-3">
        {loading ? (
          <div className="border border-zinc-200 rounded px-4 py-8 text-center text-sm text-zinc-500">Yuklanmoqda...</div>
        ) : devices.length === 0 ? (
          <div className="border border-zinc-200 rounded px-4 py-8 text-center text-sm text-zinc-500">Qurilma topilmadi</div>
        ) : (
          devices.map((device) => (
            <DeviceMobileCard key={device.id} device={device} currency={currency} />
          ))
        )}
      </div>

      {total > 0 && (
        <div className="flex flex-col gap-2 text-sm text-zinc-500 sm:flex-row sm:items-center sm:justify-between">
          <span>
            {total} ta qurilmadan {Math.min((page - 1) * PER_PAGE + 1, total)}-{Math.min(page * PER_PAGE, total)} ko&apos;rsatilmoqda
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              disabled={page === 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="h-8 rounded border-zinc-200 px-3 text-xs disabled:opacity-40"
            >
              Oldingi
            </Button>
            <span className="text-xs">{page} / {totalPages}</span>
            <Button
              variant="outline"
              disabled={page === totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="h-8 rounded border-zinc-200 px-3 text-xs disabled:opacity-40"
            >
              Keyingi
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
