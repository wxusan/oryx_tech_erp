'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { exportUrl } from '@/lib/api-client'
import { uzDate } from '@/lib/dates'
import { displayImei } from '@/lib/device-display'
import { formatMoneyByCurrency, type CurrencyContext, type CurrencyCode } from '@/lib/currency'
import { formatDisplayMoneyFromContract } from '@/lib/nasiya-contract'
import { matchesDeviceSearch } from '@/lib/search-match'

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

export default function QurilmalarClient({
  initialDevices,
  currency,
  initialStatus = 'Barchasi',
}: {
  initialDevices: Device[]
  currency: CurrencyContext
  initialStatus?: DeviceStatus | 'Barchasi'
}) {
  const [devices] = useState<Device[]>(initialDevices)
  const loading = false
  const error = ''
  const [search, setSearch] = useState('')
  const [activeStatus, setActiveStatus] = useState<DeviceStatus | 'Barchasi'>(initialStatus)

  const filtered = devices.filter((d) => {
    const matchesStatus = activeStatus === 'Barchasi' || d.status === activeStatus
    const matchesSearch = matchesDeviceSearch(
      {
        model: d.model,
        imei: d.imei,
        color: d.color,
        storage: d.storage,
        note: d.note,
        supplierName: d.supplierName,
        supplierPhone: d.supplierPhone,
      },
      search,
    )
    return matchesStatus && matchesSearch
  })

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-zinc-900">Qurilmalar</h1>
          <p className="text-sm text-zinc-500 mt-0.5">Omboringizdagi barcha qurilmalar</p>
        </div>
        <div className="flex items-center gap-2">
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
            onClick={() => setActiveStatus(tab.value)}
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
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Model, IMEI, rang, xotira yoki yetkazib beruvchi bo'yicha qidirish..."
        className="max-w-md h-9 text-sm border-zinc-200 rounded"
      />

      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-4 py-3">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-zinc-400 py-8 text-center">Yuklanmoqda...</div>
      ) : (
        /* Table */
        <div className="border border-zinc-200 rounded overflow-x-auto">
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
              {filtered.map((d) => (
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
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={12} className="px-4 py-8 text-center text-zinc-400 text-sm">
                    Qurilma topilmadi
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
