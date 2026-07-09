'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { exportUrl } from '@/lib/api-client'
import { uzDate } from '@/lib/dates'
import { displayImei } from '@/lib/device-display'
import { formatMoneyByCurrency, type CurrencyContext, type CurrencyCode } from '@/lib/currency'
import { formatDisplayMoneyFromContract } from '@/lib/nasiya-contract'

type DeviceStatus = 'IN_STOCK' | 'SOLD_CASH' | 'SOLD_NASIYA' | 'RESERVED' | 'RETURNED' | 'DELETED'
type DisplayStatus = 'Omborda' | 'Sotilgan' | 'Nasiyada' | 'Band qilingan' | 'Qaytarilgan' | "O'chirilgan"

interface DeviceSaleInfo {
  saleType: 'CASH' | 'NASIYA'
  soldPrice: number
  interestAmount: number
  profit: number | null
  // Native contract-currency ledger — see docs/currency-accounting-model.md.
  contractCurrency: CurrencyCode
  contractSoldPrice: number
  contractProfit: number | null
  customerName: string | null
  soldAt: string
  returned: boolean
  refundAmount: number | null
}

interface Device {
  id: string
  model: string
  color: string | null
  storage: string | null
  batteryHealth: number | null
  purchasePrice: number
  imei: string
  status: DeviceStatus
  createdAt: string
  note: string | null
  supplierName: string | null
  supplierPhone: string | null
  saleInfo: DeviceSaleInfo | null
}

interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
}

interface DevicesPayload {
  items: Device[]
  total: number
}

const statusMap: Record<DeviceStatus, DisplayStatus> = {
  IN_STOCK: 'Omborda',
  SOLD_CASH: 'Sotilgan',
  SOLD_NASIYA: 'Nasiyada',
  RESERVED: 'Band qilingan',
  RETURNED: 'Qaytarilgan',
  DELETED: "O'chirilgan",
}

const filterTabs: { label: string; value: DeviceStatus | 'Barchasi' }[] = [
  { label: 'Barchasi', value: 'Barchasi' },
  { label: 'Omborda', value: 'IN_STOCK' },
  { label: 'Sotilgan', value: 'SOLD_CASH' },
  { label: 'Nasiyada', value: 'SOLD_NASIYA' },
  { label: 'Qaytarilgan', value: 'RETURNED' },
]

function StatusBadge({ status }: { status: DeviceStatus }) {
  const label = statusMap[status]
  const styles: Record<DisplayStatus, string> = {
    'Omborda': 'bg-zinc-100 text-zinc-700',
    'Sotilgan': 'bg-zinc-900 text-white',
    'Nasiyada': 'bg-zinc-800 text-zinc-100',
    'Band qilingan': 'bg-amber-100 text-amber-700',
    'Qaytarilgan': 'bg-blue-100 text-blue-700',
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

// Item — real page/skip/take pagination (matches /api/logs' established
// envelope, and mijozlar/logs' client-fetch pattern) — replaces the old
// single unbounded-in-spirit fetch capped at a fixed ceiling.
const PER_PAGE = 25

function buildRequestKey(search: string, status: DeviceStatus | 'Barchasi', page: number) {
  const params = new URLSearchParams({ paginated: '1' })
  if (search.trim()) params.set('search', search.trim())
  if (status !== 'Barchasi') params.set('status', status)
  params.set('skip', String((page - 1) * PER_PAGE))
  params.set('take', String(PER_PAGE))
  return params.toString()
}

export default function QurilmalarClient({
  initialDevices,
  initialTotal,
  currency,
  initialStatus = 'Barchasi',
}: {
  initialDevices: Device[]
  initialTotal: number
  currency: CurrencyContext
  initialStatus?: DeviceStatus | 'Barchasi'
}) {
  const [devices, setDevices] = useState<Device[]>(initialDevices)
  const [total, setTotal] = useState(initialTotal)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [activeStatus, setActiveStatus] = useState<DeviceStatus | 'Barchasi'>(initialStatus)
  const [error, setError] = useState('')
  const [loadedKey, setLoadedKey] = useState(() => buildRequestKey('', initialStatus, 1))

  // Debounce the free-text search so typing doesn't fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  const requestKey = useMemo(
    () => buildRequestKey(debouncedSearch, activeStatus, page),
    [debouncedSearch, activeStatus, page],
  )

  useEffect(() => {
    if (loadedKey === requestKey) return

    const controller = new AbortController()

    fetch(`/api/devices?${requestKey}`, { signal: controller.signal })
      .then((res) => res.json())
      .then((json: ApiResponse<DevicesPayload>) => {
        if (!json.success || !json.data) {
          setError(json.error || 'Qurilmalar yuklanmadi')
          setLoadedKey(requestKey)
          return
        }
        setError('')
        setDevices(json.data.items)
        setTotal(json.data.total)
        setLoadedKey(requestKey)
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return
        setError('Qurilmalar yuklanmadi')
        setLoadedKey(requestKey)
      })

    return () => controller.abort()
  }, [loadedKey, requestKey])

  const loading = loadedKey !== requestKey
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
      <div className="flex gap-1 border-b border-zinc-200">
        {filterTabs.map((tab) => (
          <button
            key={tab.value}
            onClick={() => { setActiveStatus(tab.value); setPage(1) }}
            className={`px-3 py-2 text-sm transition-colors border-b-2 -mb-px ${
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
      <Input
        value={search}
        onChange={(e) => { setSearch(e.target.value); setPage(1) }}
        placeholder="Model, IMEI, rang, xotira yoki yetkazib beruvchi bo'yicha qidirish..."
        className="max-w-md h-9 text-sm border-zinc-200 rounded"
      />

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
                devices.map((d) => (
                <tr key={d.id} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50">
                  <td className="px-4 py-3 font-medium text-zinc-900">{d.model}</td>
                  <td className="px-4 py-3 text-zinc-600">{d.color ?? '—'}</td>
                  <td className="px-4 py-3 text-zinc-600">{d.storage ?? '—'}</td>
                  <td className="px-4 py-3 text-zinc-600">{d.batteryHealth != null ? `${d.batteryHealth}%` : '—'}</td>
                  <td className="px-4 py-3 text-zinc-900 font-medium">
                    {formatMoneyByCurrency(d.purchasePrice, currency.currency, currency.usdUzsRate)}
                  </td>
                  <td className="px-4 py-3 text-zinc-400 text-xs font-mono">{displayImei(d.imei)}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={d.status} />
                  </td>
                  <td className="px-4 py-3 text-zinc-900 font-medium">
                    {/* Converts from the deal's own contract currency, never the
                        legacy UZS snapshot re-derived through today's rate — a
                        USD-native sale must stay $500, not drift to $480.76
                        (see docs/currency-accounting-model.md). */}
                    {d.saleInfo
                      ? formatDisplayMoneyFromContract(d.saleInfo.contractSoldPrice, d.saleInfo.contractCurrency, currency.currency, currency.usdUzsRate)
                      : '—'}
                  </td>
                  <td className="px-4 py-3">
                    {!d.saleInfo ? (
                      '—'
                    ) : d.saleInfo.returned ? (
                      <span className="text-xs text-blue-700">Qaytarilgan</span>
                    ) : d.saleInfo.contractProfit != null ? (
                      <span className={d.saleInfo.contractProfit < 0 ? 'text-red-600 font-medium' : 'text-emerald-700 font-medium'}>
                        {formatDisplayMoneyFromContract(d.saleInfo.contractProfit, d.saleInfo.contractCurrency, currency.currency, currency.usdUzsRate)}
                      </span>
                    ) : (
                      // Fallback for the rare case a USD contract has no creation
                      // rate on record — conservative legacy UZS figure rather
                      // than inventing a native profit (see computeContractCurrencyMargin).
                      <span className={d.saleInfo.profit != null && d.saleInfo.profit < 0 ? 'text-red-600 font-medium' : 'text-emerald-700 font-medium'}>
                        {formatMoneyByCurrency(d.saleInfo.profit ?? 0, currency.currency, currency.usdUzsRate)}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-zinc-600">{d.saleInfo?.customerName ?? '—'}</td>
                  <td className="px-4 py-3 text-zinc-500">
                    {uzDate(d.createdAt)}
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/shop/qurilmalar/${d.id}`} prefetch={false}>
                      <button className="text-xs px-3 py-1.5 border border-zinc-200 rounded hover:bg-zinc-100 text-zinc-700 transition-colors">
                        Ko'rish
                      </button>
                    </Link>
                  </td>
                </tr>
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
          devices.map((d) => (
            <div key={d.id} className="border border-zinc-200 rounded p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-medium text-zinc-900">{d.model}</div>
                  <div className="text-xs font-mono text-zinc-500 mt-0.5">{displayImei(d.imei)}</div>
                </div>
                <StatusBadge status={d.status} />
              </div>
              <div className="text-xs text-zinc-500">
                {[d.color, d.storage, d.batteryHealth != null ? `${d.batteryHealth}%` : null].filter(Boolean).join(' · ') || '—'}
              </div>
              <div className="flex items-center justify-between text-xs text-zinc-600">
                <span>Kelish: {formatMoneyByCurrency(d.purchasePrice, currency.currency, currency.usdUzsRate)}</span>
                {d.saleInfo && <span>Sotuv: <SoldPriceValue d={d} currency={currency} /></span>}
              </div>
              {d.saleInfo && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-500">{d.saleInfo.customerName ?? '—'}</span>
                  <ProfitValue d={d} currency={currency} />
                </div>
              )}
              <div className="text-xs text-zinc-400">{uzDate(d.createdAt)}</div>
              <Link href={`/shop/qurilmalar/${d.id}`} prefetch={false} className="block">
                <Button variant="outline" className="h-8 w-full rounded border-zinc-200 text-xs">
                  Ko&apos;rish
                </Button>
              </Link>
            </div>
          ))
        )}
      </div>

      {total > 0 && (
        <div className="flex items-center justify-between text-sm text-zinc-500">
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
