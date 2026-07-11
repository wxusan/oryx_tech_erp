'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
import { formatMoneyByCurrency } from '@/lib/currency'
import { useShopCurrency } from '@/lib/use-shop-currency'
import { formatUzPhoneDisplay } from '@/lib/phone'
import { tashkentTodayInputValue } from '@/lib/timezone'

type PayableStatus = 'PENDING' | 'PAID' | 'CANCELLED' | 'OVERDUE'
type PaymentMethod = 'CASH' | 'CARD' | 'TRANSFER' | 'OTHER'

const statusLabels: Record<PayableStatus, string> = {
  PENDING: 'Kutilmoqda',
  PAID: "To'landi",
  CANCELLED: 'Bekor qilingan',
  OVERDUE: "Muddati o'tgan",
}

const statusStyles: Record<PayableStatus, string> = {
  PENDING: 'bg-zinc-100 text-zinc-700',
  PAID: 'bg-emerald-100 text-emerald-700',
  CANCELLED: 'bg-zinc-200 text-zinc-500',
  OVERDUE: 'bg-red-100 text-red-700',
}

interface OlibSotdimRow {
  id: string
  amount: number
  status: PayableStatus
  dueDate: string
  paidAt: string | null
  supplierName: string
  supplierPhone: string
  supplierLocation: string | null
  createdAt: string
  device: { id: string; model: string; imei: string; color: string | null; storage: string | null; purchasePrice: number }
  sale: { id: string; salePrice: number; customer: { name: string; phone: string } }
  profit: number
}

export default function OlibSotdimPage() {
  const { currency } = useShopCurrency()
  const [rows, setRows] = useState<OlibSotdimRow[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [payFor, setPayFor] = useState<OlibSotdimRow | null>(null)
  const [payMethod, setPayMethod] = useState<PaymentMethod | ''>('')
  const [payDate, setPayDate] = useState('')
  const [payNote, setPayNote] = useState('')
  const [payError, setPayError] = useState('')
  const [paySubmitting, setPaySubmitting] = useState(false)

  function fmt(n: number) {
    return formatMoneyByCurrency(n, currency.currency, currency.usdUzsRate)
  }

  function load(query = search) {
    setLoading(true)
    fetch(`/api/olib-sotdim?search=${encodeURIComponent(query)}`)
      .then((res) => res.json())
      .then((json) => {
        if (json.success) setRows(json.data)
        else setError(json.error || "Ro'yxat yuklanmadi")
      })
      .catch(() => setError("Ro'yxat yuklanmadi"))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    let ignore = false
    fetch('/api/olib-sotdim?search=')
      .then((res) => res.json())
      .then((json) => {
        if (ignore) return
        if (json.success) setRows(json.data)
        else setError(json.error || "Ro'yxat yuklanmadi")
      })
      .catch(() => {
        if (!ignore) setError("Ro'yxat yuklanmadi")
      })
      .finally(() => {
        if (!ignore) setLoading(false)
      })
    return () => {
      ignore = true
    }
  }, [])

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
      const res = await fetch(`/api/olib-sotdim/${payFor.id}/pay`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paymentMethod: payMethod,
          paidAt: payDate ? new Date(payDate).toISOString() : undefined,
          note: payNote.trim() || undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok || !json.success) throw new Error(json.error || "To'lovni saqlashda xatolik")
      setPayFor(null)
      load()
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
        <Link href="/shop/olib-sotdim/new">
          <Button className="h-9 px-4 text-sm bg-zinc-900 hover:bg-zinc-800 text-white rounded">
            + Olib-sotdim
          </Button>
        </Link>
      </div>

      <div className="flex max-w-md gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Yetkazib beruvchi, mijoz, model yoki IMEI bo'yicha qidirish..."
          className="h-9 text-sm border-zinc-200 rounded"
        />
        <Button onClick={() => load()} className="h-9 rounded bg-zinc-900 px-4 text-sm text-white">
          Qidirish
        </Button>
      </div>

      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-4 py-3">{error}</div>}

      <div className="border border-zinc-200 rounded overflow-x-auto">
        <table className="min-w-[1100px] w-full text-sm">
          <thead className="bg-zinc-50 border-b border-zinc-200">
            <tr>
              {['Sana', 'Qurilma', 'Yetkazib beruvchi', 'Mijoz', 'Olingan narx', 'Sotilgan narx', 'Farq', 'Holat', ''].map((h) => (
                <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-zinc-500 uppercase tracking-wide">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="px-4 py-8 text-center text-zinc-400 text-sm">Yuklanmoqda...</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={9} className="px-4 py-8 text-center text-zinc-400 text-sm">Operatsiya topilmadi</td></tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50">
                  <td className="px-4 py-3 text-zinc-500">{uzDate(row.createdAt)}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-zinc-900">{row.device.model}</div>
                    <div className="text-xs text-zinc-400 font-mono">{displayImei(row.device.imei)}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-zinc-900">{row.supplierName}</div>
                    <div className="text-xs text-zinc-500">{formatUzPhoneDisplay(row.supplierPhone)}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-zinc-900">{row.sale.customer.name}</div>
                    <div className="text-xs text-zinc-500">{formatUzPhoneDisplay(row.sale.customer.phone)}</div>
                  </td>
                  <td className="px-4 py-3 text-zinc-900 font-medium">{fmt(row.device.purchasePrice)}</td>
                  <td className="px-4 py-3 text-zinc-900 font-medium">{fmt(row.sale.salePrice)}</td>
                  <td className="px-4 py-3">
                    <span className={row.profit < 0 ? 'text-red-600 font-medium' : 'text-emerald-700 font-medium'}>{fmt(row.profit)}</span>
                    {row.status !== 'PAID' && <div className="text-[10px] text-amber-600 mt-0.5">Kutilayotgan</div>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${statusStyles[row.status]}`}>
                      {statusLabels[row.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {(row.status === 'PENDING' || row.status === 'OVERDUE') && (
                      <button
                        type="button"
                        onClick={() => openPay(row)}
                        className="text-xs px-3 py-1.5 border border-zinc-200 rounded hover:bg-zinc-100 text-zinc-700 transition-colors"
                      >
                        To&apos;landi deb belgilash
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={!!payFor} onOpenChange={(open) => !open && setPayFor(null)}>
        <DialogContent className="max-w-md rounded">
          <DialogHeader>
            <DialogTitle>Yetkazib beruvchiga to&apos;lovni qayd etish</DialogTitle>
          </DialogHeader>
          {payFor && (
            <div className="space-y-3">
              <div className="text-sm text-zinc-600">
                {payFor.supplierName} · {fmt(payFor.amount)}
              </div>
              {payError && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{payError}</div>}
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1.5">To&apos;lov usuli</label>
                <Select value={payMethod} onValueChange={(v) => v && setPayMethod(v as PaymentMethod)}>
                  <SelectTrigger className="h-9 text-sm border-zinc-200 rounded">
                    <SelectValue placeholder="Tanlang" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CASH">Naqd</SelectItem>
                    <SelectItem value="CARD">Karta</SelectItem>
                    <SelectItem value="TRANSFER">Bank o&apos;tkazma</SelectItem>
                    <SelectItem value="OTHER">Boshqa</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1.5">Sana</label>
                <Input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} className="h-9 text-sm border-zinc-200 rounded" />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1.5">Izoh</label>
                <Textarea value={payNote} onChange={(e) => setPayNote(e.target.value)} className="text-sm border-zinc-200 rounded min-h-[60px]" />
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setPayFor(null)} className="border-zinc-200 text-zinc-700 rounded">
              Bekor qilish
            </Button>
            <Button disabled={!payMethod || paySubmitting} onClick={handleMarkPaid} className="bg-zinc-900 text-white rounded">
              {paySubmitting ? 'Saqlanmoqda...' : 'Saqlash'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
