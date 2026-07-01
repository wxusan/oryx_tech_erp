'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
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
import { ArrowLeft } from 'lucide-react'

interface NasiyaSchedule {
  id: string
  monthNumber: number
  dueDate: string
  expectedAmount: number
  paidAmount: number
  status: 'PENDING' | 'PARTIAL' | 'PAID' | 'OVERDUE' | 'DEFERRED'
}

interface NasiyaPayment {
  id: string
  amount: number
  paymentMethod: string | null
  paidAt: string
  note: string | null
  nasiyaScheduleId: string | null
}

interface Nasiya {
  id: string
  totalAmount: number
  downPayment: number
  remainingAmount: number
  status: string
  device: { model: string }
  customer: { name: string; phone: string }
  schedules: NasiyaSchedule[]
  payments: NasiyaPayment[]
}

type RowStatus = 'PAID' | 'PENDING' | 'PARTIAL' | 'OVERDUE' | 'DEFERRED'

const scheduleStatusLabels: Record<RowStatus, string> = {
  PAID: "To'landi",
  PENDING: 'Kutilmoqda',
  PARTIAL: "Qisman to'landi",
  OVERDUE: "Muddati o'tgan",
  DEFERRED: "Keyinga o'tkazilgan",
}

const scheduleStatusStyles: Record<RowStatus, string> = {
  PAID: 'bg-zinc-900 text-white',
  PENDING: 'bg-zinc-100 text-zinc-600',
  PARTIAL: 'bg-zinc-200 text-zinc-700',
  OVERDUE: 'bg-red-100 text-red-700',
  DEFERRED: 'bg-yellow-100 text-yellow-800',
}

function RowBadge({ status }: { status: RowStatus }) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${scheduleStatusStyles[status]}`}>
      {scheduleStatusLabels[status]}
    </span>
  )
}

function fmt(n: number) {
  return Number(n).toLocaleString('ru-RU')
}

export default function NasiyaDetailPage() {
  const params = useParams()
  const id = params.id as string

  const [nasiya, setNasiya] = useState<Nasiya | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [paymentModalOpen, setPaymentModalOpen] = useState(false)
  const [payAmount, setPayAmount] = useState('')
  const [payMethod, setPayMethod] = useState('')
  const [payDate, setPayDate] = useState('')
  const [carryOver, setCarryOver] = useState(false)
  const [payNote, setPayNote] = useState('')
  const [selectedScheduleId, setSelectedScheduleId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [payError, setPayError] = useState('')

  const fetchNasiya = useCallback(() => {
    if (!id) return
    fetch(`/api/nasiya/${id}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.success) {
          setNasiya(json.data)
          // default selected schedule to first PENDING
          const first = json.data.schedules
            ?.filter((s: NasiyaSchedule) => ['PENDING', 'PARTIAL', 'OVERDUE', 'DEFERRED'].includes(s.status))
            .sort((a: NasiyaSchedule, b: NasiyaSchedule) => a.monthNumber - b.monthNumber)[0]
          if (first) setSelectedScheduleId(first.id)
        } else {
          setError(json.error || 'Xatolik yuz berdi')
        }
      })
      .catch(() => setError('Xatolik yuz berdi'))
      .finally(() => setLoading(false))
  }, [id])

  useEffect(() => {
    fetchNasiya()
  }, [fetchNasiya])

  const pendingSchedules = nasiya?.schedules
    ?.filter((s) => ['PENDING', 'PARTIAL', 'OVERDUE', 'DEFERRED'].includes(s.status))
    .sort((a, b) => a.monthNumber - b.monthNumber) ?? []

  const canSubmit = carryOver
    ? payDate.trim() && selectedScheduleId && payNote.trim().length >= 5
    : payAmount.trim() && payMethod && payDate.trim() && selectedScheduleId

  async function handlePaymentSubmit() {
    if (!canSubmit || submitting) return
    setSubmitting(true)
    setPayError('')
    try {
      const res = await fetch(`/api/nasiya/${id}/payment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(carryOver ? {} : { 'Idempotency-Key': crypto.randomUUID() }),
        },
        body: JSON.stringify({
          nasiyaScheduleId: selectedScheduleId,
          amount: carryOver ? 0 : Number(payAmount),
          paymentMethod: carryOver ? undefined : payMethod,
          date: new Date(payDate).toISOString(),
          delayedUntil: carryOver ? new Date(payDate).toISOString() : undefined,
          deferredToNext: carryOver,
          note: payNote || undefined,
        }),
      })
      const json = await res.json()
      if (json.success) {
        setPaymentModalOpen(false)
        setPayAmount('')
        setPayMethod('')
        setPayDate('')
        setCarryOver(false)
        setPayNote('')
        setLoading(true)
        fetchNasiya()
      } else {
        setPayError(json.error || "To'lovda xatolik")
      }
    } catch {
      setPayError("To'lovda xatolik")
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return <div className="p-6 text-sm text-zinc-400">Yuklanmoqda...</div>
  }

  if (error || !nasiya) {
    return (
      <div className="p-6">
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-4 py-3">
          {error || 'Nasiya topilmadi'}
        </div>
      </div>
    )
  }

  const paidAmount = nasiya.totalAmount - nasiya.remainingAmount
  const pct = nasiya.totalAmount > 0 ? Math.round((paidAmount / nasiya.totalAmount) * 100) : 0
  const monthlyPayment =
    nasiya.schedules?.length > 0
      ? nasiya.schedules[0].expectedAmount
      : 0

  const sortedSchedules = [...(nasiya.schedules ?? [])].sort((a, b) => a.monthNumber - b.monthNumber)

  return (
    <div className="p-6 space-y-5 max-w-4xl">
      <Link href="/shop/nasiyalar" className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900">
        <ArrowLeft size={14} />
        Nasiyalarga qaytish
      </Link>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">{nasiya.customer.name}</h1>
          <p className="text-sm text-zinc-500 mt-0.5">{nasiya.device.model} · {nasiya.customer.phone}</p>
        </div>
        <Button
          onClick={() => setPaymentModalOpen(true)}
          className="h-9 px-4 text-sm bg-zinc-900 hover:bg-zinc-800 text-white rounded"
        >
          To'lov qabul qilish
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Jami summa', value: `${fmt(nasiya.totalAmount)} so'm` },
          { label: "To'langan", value: `${fmt(paidAmount)} so'm` },
          { label: 'Qolgan', value: `${fmt(nasiya.remainingAmount)} so'm` },
          { label: 'Oylik', value: `${fmt(monthlyPayment)} so'm` },
        ].map((c) => (
          <div key={c.label} className="border border-zinc-200 rounded p-3">
            <div className="text-xs text-zinc-500 mb-1">{c.label}</div>
            <div className="text-base font-bold text-zinc-900">{c.value}</div>
          </div>
        ))}
      </div>

      {/* Progress */}
      <div className="border border-zinc-200 rounded p-4">
        <div className="flex justify-between text-sm mb-2">
          <span className="text-zinc-600 font-medium">Umumiy progress</span>
          <span className="font-bold text-zinc-900">{pct}%</span>
        </div>
        <div className="w-full bg-zinc-100 h-2.5 rounded-full overflow-hidden">
          <div
            className="h-full bg-zinc-900 rounded-full transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="flex justify-between text-xs text-zinc-400 mt-1.5">
          <span>{fmt(paidAmount)} so'm</span>
          <span>{fmt(nasiya.totalAmount)} so'm</span>
        </div>
      </div>

      {/* Payment schedule */}
      <div className="border border-zinc-200 rounded overflow-hidden">
        <div className="px-4 py-3 bg-zinc-50 border-b border-zinc-200 font-semibold text-sm text-zinc-900">
          To'lov jadvali
        </div>
        <div className="overflow-x-auto">
        <table className="min-w-[640px] w-full text-sm">
          <thead className="border-b border-zinc-200">
            <tr>
                {['#', 'Sana', 'Miqdor', "To'langan", 'Status'].map((h) => (
                <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-zinc-500 uppercase tracking-wide bg-zinc-50">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedSchedules.map((row) => (
              <tr key={row.id} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50">
                <td className="px-4 py-3 text-zinc-500">{row.monthNumber}</td>
                <td className="px-4 py-3 text-zinc-700">
                  {new Date(row.dueDate).toLocaleDateString('uz-UZ')}
                </td>
                <td className="px-4 py-3 font-medium text-zinc-900">{fmt(row.expectedAmount)} so'm</td>
                <td className="px-4 py-3 text-zinc-700">{fmt(row.paidAmount)} so'm</td>
                <td className="px-4 py-3">
                  <RowBadge status={row.status as RowStatus} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      <div className="border border-zinc-200 rounded overflow-hidden">
        <div className="px-4 py-3 bg-zinc-50 border-b border-zinc-200 font-semibold text-sm text-zinc-900">
          To'lov tarixi
        </div>
        {nasiya.payments?.length ? (
          <div className="overflow-x-auto">
          <table className="min-w-[560px] w-full text-sm">
            <thead className="border-b border-zinc-200">
              <tr>
                {['Sana', 'Miqdor', 'Usul', 'Izoh'].map((h) => (
                  <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-zinc-500 uppercase tracking-wide bg-zinc-50">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {nasiya.payments.map((payment) => (
                <tr key={payment.id} className="border-b border-zinc-100 last:border-0">
                  <td className="px-4 py-3 text-zinc-700">{new Date(payment.paidAt).toLocaleDateString('uz-UZ')}</td>
                  <td className="px-4 py-3 font-medium text-zinc-900">{fmt(payment.amount)} so'm</td>
                  <td className="px-4 py-3 text-zinc-700">{payment.paymentMethod ?? '—'}</td>
                  <td className="px-4 py-3 text-zinc-500">{payment.note ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        ) : (
          <div className="px-4 py-6 text-sm text-zinc-500">To'lov tarixi hali yo'q</div>
        )}
      </div>

      {/* Payment Dialog */}
      <Dialog open={paymentModalOpen} onOpenChange={setPaymentModalOpen}>
        <DialogContent className="max-w-md rounded">
          <DialogHeader>
            <DialogTitle className="text-zinc-900">To'lov qabul qilish</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            {payError && (
              <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
                {payError}
              </div>
            )}

            {pendingSchedules.length > 0 && (
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1.5">
                  To'lov oyi <span className="text-red-500">*</span>
                </label>
                <Select value={selectedScheduleId} onValueChange={(v) => v && setSelectedScheduleId(v)}>
                  <SelectTrigger className="h-9 text-sm border-zinc-200 rounded">
                    <SelectValue placeholder="Oyni tanlang" />
                  </SelectTrigger>
                  <SelectContent>
                    {pendingSchedules.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.monthNumber}-oy · {new Date(s.dueDate).toLocaleDateString('uz-UZ')} · {fmt(s.expectedAmount)} so'm
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1.5">
                Miqdor {!carryOver && <span className="text-red-500">*</span>}
              </label>
              <Input
                type="number"
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                placeholder="1 000 000"
                disabled={carryOver}
                className="h-9 text-sm border-zinc-200 rounded"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1.5">
                To'lov usuli {!carryOver && <span className="text-red-500">*</span>}
              </label>
              <Select value={payMethod} onValueChange={(v) => v && setPayMethod(v)}>
                <SelectTrigger className="h-9 text-sm border-zinc-200 rounded" disabled={carryOver}>
                  <SelectValue placeholder="Usulni tanlang" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CASH">Naqd</SelectItem>
                  <SelectItem value="CARD">Karta</SelectItem>
                  <SelectItem value="TRANSFER">Bank</SelectItem>
                  <SelectItem value="OTHER">Boshqa</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1.5">
                {carryOver ? 'Kechiktirilgan sana' : 'Sana'} <span className="text-red-500">*</span>
              </label>
              <Input
                type="date"
                value={payDate}
                onChange={(e) => setPayDate(e.target.value)}
                className="h-9 text-sm border-zinc-200 rounded"
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="carry-over"
                checked={carryOver}
                onChange={(e) => setCarryOver(e.target.checked)}
                className="w-4 h-4 rounded border-zinc-300"
              />
              <label htmlFor="carry-over" className="text-sm text-zinc-700 cursor-pointer">
                To'lov muddatini uzaytirish
              </label>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-700 mb-1.5">
                Izoh {carryOver && <span className="text-red-500">*</span>}
              </label>
              <Textarea
                value={payNote}
                onChange={(e) => setPayNote(e.target.value)}
                placeholder="Ixtiyoriy izoh..."
                className="text-sm border-zinc-200 rounded min-h-[70px]"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => { setPaymentModalOpen(false); setPayError('') }}
              className="border-zinc-200 text-zinc-700 rounded"
            >
              Bekor qilish
            </Button>
            <Button
              disabled={!canSubmit || submitting}
              onClick={handlePaymentSubmit}
              className="bg-zinc-900 hover:bg-zinc-800 text-white rounded disabled:opacity-40"
            >
              {submitting ? 'Saqlanmoqda...' : 'Saqlash'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
