'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
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
  salePrice: number
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
  color: string
  storage: string
  batteryHealth: number
  purchasePrice: number
  imei: string
  supplier: Supplier | null
  status: 'IN_STOCK' | 'SOLD_CASH' | 'SOLD_NASIYA' | 'DELETED'
  createdAt: string
  sales?: Sale[]
  nasiya?: Nasiya[]
}

const statusLabels: Record<string, string> = {
  IN_STOCK: 'Omborda',
  SOLD_CASH: 'Naqd sotildi',
  SOLD_NASIYA: 'Nasiyada',
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
    { label: 'Rang', value: device.color },
    { label: 'Xotira', value: device.storage },
    { label: 'Batareya', value: `${device.batteryHealth}%` },
    { label: 'Narx', value: fmt(device.purchasePrice) },
    { label: 'IMEI', value: device.imei },
    { label: 'Yetkazib beruvchi', value: device.supplier?.name ?? '—' },
    { label: 'Tel raqam', value: device.supplier?.phone ?? '—' },
    { label: "Qo'shilgan sana", value: new Date(device.createdAt).toLocaleDateString('uz-UZ') },
    { label: 'Status', value: statusLabels[device.status] ?? device.status },
  ]

  const showSaleActions = device.status === 'IN_STOCK'
  const latestSale = device.sales?.[0]
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
          <Button
            variant="outline"
            onClick={() => setDeleteModalOpen(true)}
            className="h-9 w-9 p-0 border-zinc-200 text-red-500 hover:bg-red-50 hover:border-red-200 rounded"
          >
            <Trash2 size={15} />
          </Button>
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
              <span className="text-zinc-500 w-32">To'lov usuli</span>
              <span className="text-zinc-900 font-medium">{latestSale.paymentMethod}</span>
            </div>
            <div className="flex gap-4 text-sm">
              <span className="text-zinc-500 w-32">Sotilgan sana</span>
              <span className="text-zinc-900 font-medium">
                {new Date(latestSale.createdAt).toLocaleDateString('uz-UZ')}
              </span>
            </div>
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
    </div>
  )
}
