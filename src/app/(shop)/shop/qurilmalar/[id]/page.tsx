'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
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
import { ArrowLeft, Trash2 } from 'lucide-react'

interface Supplier {
  name: string
  phone: string
}

interface Sale {
  id: string
  salePrice: number
  amountPaid: number
  remainingAmount: number
  dueDate: string | null
  paidFully: boolean
  customer?: { name: string; phone: string }
  paymentMethod: string
  createdAt: string
}

interface NasiyaSchedule {
  id: string
  monthNumber: number
  dueDate: string
  expectedAmount: number
  status: string
}

interface Nasiya {
  id: string
  totalAmount: number
  remainingAmount: number
  customer: { name: string; phone: string }
  schedules: NasiyaSchedule[]
}

interface Device {
  id: string
  model: string
  color: string | null
  storage: string | null
  batteryHealth: number | null
  purchasePrice: number
  imei: string
  supplier: Supplier | null
  status: 'IN_STOCK' | 'SOLD_CASH' | 'SOLD_NASIYA' | 'RESERVED' | 'RETURNED' | 'DELETED'
  createdAt: string
  sales?: Sale[]
  nasiya?: Nasiya[]
}

const statusLabels: Record<string, string> = {
  IN_STOCK: 'Omborda',
  SOLD_CASH: 'Naqd sotildi',
  SOLD_NASIYA: 'Nasiyada',
  RESERVED: 'Band qilingan',
  RETURNED: 'Qaytarilgan',
  DELETED: "O'chirilgan",
}

function fmt(n: number) {
  return Number(n).toLocaleString('ru-RU') + " so'm"
}

export default function QurilmaDetailPage() {
  const params = useParams()
  const router = useRouter()
  const id = params.id as string

  const [device, setDevice] = useState<Device | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [deleteNote, setDeleteNote] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [salePaymentOpen, setSalePaymentOpen] = useState(false)
  const [salePayAmount, setSalePayAmount] = useState('')
  const [salePayMethod, setSalePayMethod] = useState('')
  const [salePayNote, setSalePayNote] = useState('')
  const [salePayError, setSalePayError] = useState('')
  const [salePayLoading, setSalePayLoading] = useState(false)

  useEffect(() => {
    if (!id) return
    fetch(`/api/devices/${id}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.success) setDevice(json.data)
        else setError(json.error || 'Xatolik yuz berdi')
      })
      .catch(() => setError('Xatolik yuz berdi'))
      .finally(() => setLoading(false))
  }, [id])

  async function handleDelete() {
    if (!deleteNote.trim()) return
    setDeleting(true)
    setDeleteError('')
    try {
      const res = await fetch(`/api/devices/${id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deleteNote }),
      })
      const json = await res.json()
      if (json.success) {
        router.push('/shop/qurilmalar')
      } else {
        setDeleteError(json.error || "O'chirishda xatolik")
      }
    } catch {
      setDeleteError("O'chirishda xatolik")
    } finally {
      setDeleting(false)
    }
  }

  async function handleSalePayment() {
    if (!latestSale || !salePayAmount || !salePayMethod || salePayLoading) return
    setSalePayLoading(true)
    setSalePayError('')
    try {
      const res = await fetch(`/api/sales/${latestSale.id}/payment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({
          amount: Number(salePayAmount),
          paymentMethod: salePayMethod,
          note: salePayNote.trim() || undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok || !json.success) {
        throw new Error(json.error || "To'lovni saqlashda xatolik")
      }
      setSalePaymentOpen(false)
      setSalePayAmount('')
      setSalePayMethod('')
      setSalePayNote('')
      window.location.reload()
    } catch (err) {
      setSalePayError(err instanceof Error ? err.message : "To'lovni saqlashda xatolik")
    } finally {
      setSalePayLoading(false)
    }
  }

  if (loading) {
    return <div className="p-6 text-sm text-zinc-400">Yuklanmoqda...</div>
  }

  if (error || !device) {
    return (
      <div className="p-6">
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-4 py-3">
          {error || 'Qurilma topilmadi'}
        </div>
      </div>
    )
  }

  const infoRows = [
    { label: 'Model', value: device.model },
    { label: 'Rang', value: device.color ?? '—' },
    { label: 'Xotira', value: device.storage ?? '—' },
    { label: 'Batareya', value: device.batteryHealth != null ? `${device.batteryHealth}%` : '—' },
    { label: 'Kelish narxi', value: fmt(device.purchasePrice) },
    { label: 'IMEI', value: device.imei },
    { label: 'Yetkazib beruvchi', value: device.supplier?.name ?? '—' },
    { label: 'Tel raqam', value: device.supplier?.phone ?? '—' },
    { label: "Qo'shilgan sana", value: new Date(device.createdAt).toLocaleDateString('uz-UZ') },
    { label: 'Status', value: statusLabels[device.status] ?? device.status },
  ]

  const showSaleActions = device.status === 'IN_STOCK'
  const latestSale = device.sales?.[0]
  const saleHasDebt = latestSale ? Number(latestSale.remainingAmount) > 0 && !latestSale.paidFully : false
  const latestNasiya = device.nasiya?.[0]
  const nasiyaPct = latestNasiya
    ? Math.round(
        ((latestNasiya.totalAmount - latestNasiya.remainingAmount) / latestNasiya.totalAmount) * 100
      )
    : 0

  return (
    <div className="p-6 space-y-5 max-w-3xl">
      {/* Back */}
      <Link href="/shop/qurilmalar" className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900">
        <ArrowLeft size={14} />
        Qurilmalarga qaytish
      </Link>

      {/* Top row */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-zinc-900">{device.model}</h1>
          <span className="inline-block px-2.5 py-1 bg-zinc-100 text-zinc-700 text-xs font-medium rounded">
            {statusLabels[device.status] ?? device.status}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {showSaleActions && (
            <>
              <Link href={`/shop/sotuv/new?deviceId=${device.id}`}>
                <Button className="h-9 px-4 text-sm bg-zinc-900 hover:bg-zinc-800 text-white rounded">
                  Naqd sotish
                </Button>
              </Link>
              <Link href={`/shop/nasiyalar/new?deviceId=${device.id}`}>
                <Button variant="outline" className="h-9 px-4 text-sm border-zinc-200 text-zinc-700 hover:bg-zinc-50 rounded">
                  Nasiyaga berish
                </Button>
              </Link>
            </>
          )}
          {!['SOLD_CASH', 'SOLD_NASIYA'].includes(device.status) && (
            <Button
              variant="outline"
              aria-label="Qurilmani o'chirish"
              onClick={() => setDeleteModalOpen(true)}
              className="h-9 w-9 p-0 border-zinc-200 text-red-500 hover:bg-red-50 hover:border-red-200 rounded"
            >
              <Trash2 size={15} />
            </Button>
          )}
        </div>
      </div>

      {/* Device info card */}
      <div className="border border-zinc-200 rounded overflow-hidden">
        <div className="px-4 py-3 bg-zinc-50 border-b border-zinc-200">
          <span className="text-sm font-semibold text-zinc-900">Qurilma ma'lumotlari</span>
        </div>
        <div className="grid grid-cols-2 divide-x divide-zinc-100">
          {infoRows.map((row, i) => (
            <div
              key={row.label}
              className={`px-4 py-3 flex gap-4 ${i < infoRows.length - 2 ? 'border-b border-zinc-100' : ''}`}
            >
              <span className="text-xs text-zinc-500 w-32 flex-shrink-0 pt-0.5">{row.label}</span>
              <span className="text-sm text-zinc-900 font-medium">{row.value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Sale info section */}
      {device.status === 'SOLD_CASH' && latestSale && (
        <div className="border border-zinc-200 rounded overflow-hidden">
          <div className="px-4 py-3 bg-zinc-50 border-b border-zinc-200">
            <span className="text-sm font-semibold text-zinc-900">Sotuv ma'lumotlari</span>
          </div>
          <div className="p-4 space-y-2">
            <div className="flex gap-4 text-sm">
              <span className="text-zinc-500 w-32">Mijoz</span>
              <span className="text-zinc-900 font-medium">{latestSale.customer?.name ?? '—'}</span>
            </div>
            <div className="flex gap-4 text-sm">
              <span className="text-zinc-500 w-32">Tel raqam</span>
              <span className="text-zinc-900 font-medium">{latestSale.customer?.phone ?? '—'}</span>
            </div>
            <div className="flex gap-4 text-sm">
              <span className="text-zinc-500 w-32">Sotuv narxi</span>
              <span className="text-zinc-900 font-medium">{fmt(latestSale.salePrice)}</span>
            </div>
            <div className="flex gap-4 text-sm">
              <span className="text-zinc-500 w-32">To'langan</span>
              <span className="text-zinc-900 font-medium">{fmt(latestSale.amountPaid)}</span>
            </div>
            <div className="flex gap-4 text-sm">
              <span className="text-zinc-500 w-32">Qolgan</span>
              <span className={saleHasDebt ? 'text-red-700 font-medium' : 'text-zinc-900 font-medium'}>
                {fmt(latestSale.remainingAmount)}
              </span>
            </div>
            {latestSale.dueDate && (
              <div className="flex gap-4 text-sm">
                <span className="text-zinc-500 w-32">Muddat</span>
                <span className="text-zinc-900 font-medium">{new Date(latestSale.dueDate).toLocaleDateString('uz-UZ')}</span>
              </div>
            )}
            <div className="flex gap-4 text-sm">
              <span className="text-zinc-500 w-32">To'lov usuli</span>
              <span className="text-zinc-900 font-medium">{latestSale.paymentMethod}</span>
            </div>
            <div className="flex gap-4 text-sm">
              <span className="text-zinc-500 w-32">Sotilgan sana</span>
              <span className="text-zinc-900 font-medium">
                {new Date(latestSale.createdAt).toLocaleDateString('uz-UZ')}
              </span>
            </div>
            {saleHasDebt && (
              <Button
                onClick={() => {
                  setSalePayAmount(String(latestSale.remainingAmount))
                  setSalePaymentOpen(true)
                }}
                className="mt-2 h-9 px-4 text-sm bg-zinc-900 hover:bg-zinc-800 text-white rounded"
              >
                Qolgan to'lovni qabul qilish
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Nasiya info section */}
      {device.status === 'SOLD_NASIYA' && latestNasiya && (
        <div className="border border-zinc-200 rounded overflow-hidden">
          <div className="px-4 py-3 bg-zinc-50 border-b border-zinc-200">
            <span className="text-sm font-semibold text-zinc-900">Nasiya ma'lumotlari</span>
          </div>
          <div className="p-4 space-y-4">
            <div className="space-y-2">
              <div className="flex gap-4 text-sm">
                <span className="text-zinc-500 w-32">Mijoz</span>
                <span className="text-zinc-900 font-medium">{latestNasiya.customer.name}</span>
              </div>
              <div className="flex gap-4 text-sm">
                <span className="text-zinc-500 w-32">Tel raqam</span>
                <span className="text-zinc-900 font-medium">{latestNasiya.customer.phone}</span>
              </div>
              <div className="flex gap-4 text-sm">
                <span className="text-zinc-500 w-32">Jami summa</span>
                <span className="text-zinc-900 font-medium">{fmt(latestNasiya.totalAmount)}</span>
              </div>
              <div className="flex gap-4 text-sm">
                <span className="text-zinc-500 w-32">Qolgan summa</span>
                <span className="text-zinc-900 font-medium">{fmt(latestNasiya.remainingAmount)}</span>
              </div>
            </div>
            <div>
              <div className="flex justify-between text-xs text-zinc-500 mb-1">
                <span>To'langan</span>
                <span>{nasiyaPct}%</span>
              </div>
              <div className="w-full bg-zinc-100 h-2 rounded-full overflow-hidden">
                <div
                  className="h-full bg-zinc-900 rounded-full"
                  style={{ width: `${nasiyaPct}%` }}
                />
              </div>
            </div>
            <Link href={`/shop/nasiyalar/${latestNasiya.id}`}>
              <Button variant="outline" className="text-sm border-zinc-200 text-zinc-700 rounded mt-2">
                Nasiyani ko'rish
              </Button>
            </Link>
          </div>
        </div>
      )}

      {/* Delete Dialog */}
      <Dialog open={deleteModalOpen} onOpenChange={setDeleteModalOpen}>
        <DialogContent className="max-w-md rounded">
          <DialogHeader>
            <DialogTitle className="text-zinc-900">Qurilmani o'chirish</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-zinc-600">
              <span className="font-medium">{device.model}</span> qurilmasini o'chirishdan oldin sababini kiriting.
            </p>
            {deleteError && (
              <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
                {deleteError}
              </div>
            )}
            <div>
              <label className="text-xs font-medium text-zinc-700 block mb-1.5">
                Sabab <span className="text-red-500">*</span>
              </label>
              <Textarea
                value={deleteNote}
                onChange={(e) => setDeleteNote(e.target.value)}
                placeholder="Masalan: Qurilma buzilgan, yo'qolgan..."
                className="text-sm border-zinc-200 rounded min-h-[80px]"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => { setDeleteModalOpen(false); setDeleteNote(''); setDeleteError('') }}
              className="border-zinc-200 text-zinc-700 rounded"
            >
              Bekor qilish
            </Button>
            <Button
              disabled={!deleteNote.trim() || deleting}
              onClick={handleDelete}
              className="bg-red-600 hover:bg-red-700 text-white rounded disabled:opacity-40"
            >
              {deleting ? 'O\'chirilmoqda...' : 'O\'chirish'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={salePaymentOpen} onOpenChange={setSalePaymentOpen}>
        <DialogContent className="max-w-md rounded">
          <DialogHeader>
            <DialogTitle className="text-zinc-900">Qolgan to'lovni qabul qilish</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {salePayError && (
              <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
                {salePayError}
              </div>
            )}
            <div>
              <label className="text-xs font-medium text-zinc-700 block mb-1.5">Miqdor</label>
              <Input
                type="number"
                value={salePayAmount}
                onChange={(e) => setSalePayAmount(e.target.value)}
                className="h-9 text-sm border-zinc-200 rounded"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-zinc-700 block mb-1.5">To'lov usuli</label>
              <select
                value={salePayMethod}
                onChange={(e) => setSalePayMethod(e.target.value)}
                className="w-full h-9 text-sm border border-zinc-200 bg-white px-2 rounded"
              >
                <option value="">Tanlang...</option>
                <option value="CASH">Naqd</option>
                <option value="CARD">Karta</option>
                <option value="TRANSFER">Bank</option>
                <option value="OTHER">Boshqa</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-zinc-700 block mb-1.5">Izoh</label>
              <Textarea
                value={salePayNote}
                onChange={(e) => setSalePayNote(e.target.value)}
                className="text-sm border-zinc-200 rounded min-h-[70px]"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setSalePaymentOpen(false)} className="border-zinc-200 text-zinc-700 rounded">
              Bekor qilish
            </Button>
            <Button
              disabled={!salePayAmount || !salePayMethod || salePayLoading}
              onClick={handleSalePayment}
              className="bg-zinc-900 hover:bg-zinc-800 text-white rounded disabled:opacity-40"
            >
              {salePayLoading ? 'Saqlanmoqda...' : 'Saqlash'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
