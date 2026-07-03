'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { paymentMethodLabel } from '@/lib/labels'
import { scheduleDisplayStatus } from '@/lib/nasiya-utils'
import { uzDate, uzDateTime, uzMonthYear } from '@/lib/dates'
import { ArrowLeft, Pencil } from 'lucide-react'

interface NasiyaSchedule {
  id: string
  monthNumber: number
  dueDate: string
  delayedUntil: string | null
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

interface NasiyaLog {
  id: string
  action: string
  note: string | null
  targetType: string
  targetId: string
  createdAt: string
}

interface Nasiya {
  id: string
  shopId: string
  totalAmount: number
  downPayment: number
  baseRemainingAmount: number
  interestPercent: number
  interestAmount: number
  finalNasiyaAmount: number
  remainingAmount: number
  status: string
  reminderEnabled: boolean
  note?: string | null
  isImported?: boolean
  importSource?: string | null
  importedAt?: string | null
  originalSaleDate?: string | null
  originalTotalAmount?: number | null
  alreadyPaidBeforeImport?: number | null
  remainingAtImport?: number | null
  importNote?: string | null
  device: { model: string }
  customer: { name: string; phone: string; passportPhotoUrl?: string | null }
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

function ImportField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-amber-700/70">{label}</div>
      <div className="mt-0.5 font-medium text-amber-900">{value}</div>
    </div>
  )
}

function nasiyaLogLabel(action: string) {
  if (action === 'CREATE_NASIYA') return 'Nasiya yaratildi'
  if (action === 'IMPORT_NASIYA') return 'Eski nasiya import qilindi'
  if (action === 'PAYMENT') return "To'lov qabul qilindi"
  if (action === 'UPDATE_REMINDER') return "Eslatma o'zgartirildi"
  if (action === 'UPDATE') return "Ma'lumot o'zgartirildi"
  if (action === 'DELETE') return "O'chirildi"
  if (action === 'RETURN') return 'Qaytarildi'
  return action
}

function scheduleBalance(row: NasiyaSchedule) {
  return Math.max(0, Number(row.expectedAmount) - Number(row.paidAmount))
}

/**
 * Effective status shown for a schedule row. An unpaid row past its effective
 * due date reads as OVERDUE even before cron flips the stored status, so the
 * detail page agrees with the list and dashboard.
 */
function rowDisplayStatus(row: NasiyaSchedule): RowStatus {
  return scheduleDisplayStatus(row) as RowStatus
}

/** Short, readable label for the selected-month trigger: "3-oy · Sentabr 2026". */
function scheduleTriggerLabel(row: NasiyaSchedule) {
  return `${row.monthNumber}-oy · ${uzMonthYear(row.dueDate)}`
}

export default function NasiyaDetailPage() {
  const params = useParams()
  const id = params.id as string

  const [nasiya, setNasiya] = useState<Nasiya | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [passportUrl, setPassportUrl] = useState<string | null>(null)
  const [reminderSubmitting, setReminderSubmitting] = useState(false)
  const [logs, setLogs] = useState<NasiyaLog[]>([])

  const [paymentModalOpen, setPaymentModalOpen] = useState(false)
  const [payAmount, setPayAmount] = useState('')
  const [payMethod, setPayMethod] = useState('')
  const [payDate, setPayDate] = useState('')
  const [carryOver, setCarryOver] = useState(false)
  const [payNote, setPayNote] = useState('')
  const [selectedScheduleId, setSelectedScheduleId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [payError, setPayError] = useState('')

  const [editOpen, setEditOpen] = useState(false)
  const [editNote, setEditNote] = useState('')
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState('')

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

  // Fetch a signed URL for the customer's passport photo (stored as a storage key).
  const passportKey = nasiya?.customer?.passportPhotoUrl ?? null
  useEffect(() => {
    // When there's no passport key the render guards on `passportKey && passportUrl`,
    // so no state reset is needed here (avoids a synchronous setState in the effect).
    if (!passportKey) return
    let cancelled = false
    fetch(`/api/uploads/passport?key=${encodeURIComponent(passportKey)}`)
      .then((r) => r.json())
      .then((json) => {
        if (!cancelled && json.success && json.data?.url) setPassportUrl(json.data.url)
      })
      .catch(() => {
        if (!cancelled) setPassportUrl(null)
      })
    return () => {
      cancelled = true
    }
  }, [passportKey])

  // Fetch recent action logs for this nasiya (reminder toggles, payments, etc.).
  const nasiyaShopId = nasiya?.shopId
  const nasiyaId = nasiya?.id
  useEffect(() => {
    if (!nasiyaId) return
    const targetIds = [nasiyaId, ...(nasiya?.schedules?.map((s) => s.id) ?? [])]
    const url = new URL('/api/logs', window.location.origin)
    if (nasiyaShopId) url.searchParams.set('shopId', nasiyaShopId)
    url.searchParams.set('take', '100')
    url.searchParams.set('targetId', targetIds.join(','))
    let cancelled = false
    fetch(url.toString())
      .then((r) => r.json())
      .then((json) => {
        if (cancelled || !json.success) return
        setLogs(json.data?.logs ?? [])
      })
      .catch(() => {
        if (!cancelled) setLogs([])
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nasiyaId, nasiyaShopId])

  function openEdit() {
    setEditNote(nasiya?.note ?? '')
    setEditError('')
    setEditOpen(true)
  }

  async function handleEditSave() {
    if (!nasiya || editSaving) return
    setEditSaving(true)
    setEditError('')
    try {
      const res = await fetch(`/api/nasiya/${nasiya.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: editNote.trim() }),
      })
      const json = await res.json()
      if (json.success) {
        setEditOpen(false)
        fetchNasiya()
      } else {
        setEditError(json.error || "Saqlashda xatolik")
      }
    } catch {
      setEditError("Saqlashda xatolik")
    } finally {
      setEditSaving(false)
    }
  }

  async function handleToggleReminder() {
    if (!nasiya || reminderSubmitting) return
    setReminderSubmitting(true)
    try {
      const res = await fetch(`/api/nasiya/${nasiya.id}/reminder`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reminderEnabled: !nasiya.reminderEnabled }),
      })
      const json = await res.json()
      if (json.success) fetchNasiya()
    } catch {
      // silent — state is re-derived from server on next fetch
    } finally {
      setReminderSubmitting(false)
    }
  }

  const pendingSchedules = nasiya?.schedules
    ?.filter((s) => ['PENDING', 'PARTIAL', 'OVERDUE', 'DEFERRED'].includes(s.status))
    .sort((a, b) => a.monthNumber - b.monthNumber) ?? []

  const canSubmit = carryOver
    ? payDate.trim() && selectedScheduleId && payNote.trim().length >= 5
    : payAmount.trim() && payMethod && payDate.trim() && selectedScheduleId && payNote.trim().length >= 5

  async function handlePaymentSubmit() {
    if (!canSubmit || submitting) return
    setSubmitting(true)
    setPayError('')
    try {
      const idempotencyKey = crypto.randomUUID()
      const res = await fetch(`/api/nasiya/${id}/payment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
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

  const paidAmount = nasiya.finalNasiyaAmount - nasiya.remainingAmount
  const pct = nasiya.finalNasiyaAmount > 0 ? Math.round((paidAmount / nasiya.finalNasiyaAmount) * 100) : 0
  const monthlyPayment =
    nasiya.schedules?.length > 0
      ? nasiya.schedules[0].expectedAmount
      : 0

  const sortedSchedules = [...(nasiya.schedules ?? [])].sort((a, b) => a.monthNumber - b.monthNumber)
  const selectedSchedule = pendingSchedules.find((s) => s.id === selectedScheduleId)
  const selectedScheduleOutstanding = selectedSchedule ? scheduleBalance(selectedSchedule) : 0

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
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={openEdit}
            className="h-9 px-3 text-sm border-zinc-200 text-zinc-700 hover:bg-zinc-50 rounded"
          >
            <Pencil size={14} />
            Tahrirlash
          </Button>
          <Button
            onClick={() => setPaymentModalOpen(true)}
            className="h-9 px-4 text-sm bg-zinc-900 hover:bg-zinc-800 text-white rounded"
          >
            To'lov qabul qilish
          </Button>
        </div>
      </div>

      {nasiya.note && (
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3">
          <div className="text-xs font-medium text-zinc-500">Izoh</div>
          <div className="mt-1 text-sm text-zinc-800 whitespace-pre-wrap">{nasiya.note}</div>
        </div>
      )}

      {nasiya.isImported && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-center gap-2">
            <span className="inline-block rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
              Eski nasiya
            </span>
            <span className="text-sm font-semibold text-amber-900">Import qilingan nasiya</span>
          </div>
          <p className="mt-1 text-xs text-amber-800/80">
            Bu Oryx'dan oldingi eski nasiya. Importgacha to'langan pul joriy oy daromadiga qo'shilmaydi.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
            <ImportField label="Manba" value={nasiya.importSource === 'MANUAL' ? "Qo'lda" : nasiya.importSource ?? '—'} />
            <ImportField label="Import sanasi" value={nasiya.importedAt ? uzDate(nasiya.importedAt) : '—'} />
            <ImportField label="Eski sotuv sanasi" value={nasiya.originalSaleDate ? uzDate(nasiya.originalSaleDate) : '—'} />
            <ImportField label="Eski nasiya summasi" value={`${fmt(nasiya.originalTotalAmount ?? 0)} so'm`} />
            <ImportField label="Importgacha to'langan" value={`${fmt(nasiya.alreadyPaidBeforeImport ?? 0)} so'm`} />
            <ImportField label="Import paytidagi qarz" value={`${fmt(nasiya.remainingAtImport ?? 0)} so'm`} />
          </div>
          {nasiya.importNote && (
            <div className="mt-3 text-xs text-amber-800">
              <span className="font-medium">Izoh:</span> {nasiya.importNote}
            </div>
          )}
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        {[
          { label: 'Jami narx', value: `${fmt(nasiya.totalAmount)} so'm` },
          { label: "Boshlang'ich to'lov", value: `${fmt(nasiya.downPayment)} so'm` },
          { label: 'Qolgan summa', value: `${fmt(nasiya.baseRemainingAmount)} so'm` },
          ...(nasiya.interestAmount > 0
            ? [
                { label: 'Nasiya foizi', value: `${fmt(nasiya.interestPercent)}%` },
                { label: 'Foiz summasi', value: `${fmt(nasiya.interestAmount)} so'm` },
              ]
            : []),
          { label: 'Nasiya jami', value: `${fmt(nasiya.finalNasiyaAmount)} so'm` },
          { label: "To'langan", value: `${fmt(paidAmount)} so'm` },
          { label: "Qarz qoldig'i", value: `${fmt(nasiya.remainingAmount)} so'm` },
          { label: 'Oylik', value: `${fmt(monthlyPayment)} so'm` },
        ].map((c) => (
          <Card key={c.label} className="rounded-lg" size="sm">
            <CardContent>
              <div className="text-xs text-zinc-500 mb-1">{c.label}</div>
              <div className="text-base font-bold text-zinc-900">{c.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Progress */}
      <Card className="rounded-lg">
        <CardHeader>
          <CardTitle>Umumiy progress</CardTitle>
          <CardDescription>Nasiya bo'yicha jami to'langan summa</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex justify-between text-sm mb-2">
            <span className="text-zinc-600 font-medium">{fmt(paidAmount)} so'm to'landi</span>
            <span className="font-bold text-zinc-900">{pct}%</span>
          </div>
          <Progress value={pct} className="h-2.5 rounded-full" />
          <div className="flex justify-between text-xs text-zinc-400 mt-1.5">
            <span>0 so'm</span>
            <span>{fmt(nasiya.finalNasiyaAmount)} so'm</span>
          </div>
        </CardContent>
      </Card>

      {/* Reminder toggle */}
      <div className="border border-zinc-200 rounded p-4 flex items-center justify-between gap-4">
        <div>
          <div className="text-sm font-semibold text-zinc-900">To'lov eslatmasi</div>
          <div className="text-xs text-zinc-500 mt-0.5">
            {nasiya.reminderEnabled ? 'Eslatma yoqilgan' : "Eslatma o'chirilgan"}
          </div>
        </div>
        <Button
          onClick={handleToggleReminder}
          disabled={reminderSubmitting}
          variant={nasiya.reminderEnabled ? 'outline' : 'default'}
          className={
            nasiya.reminderEnabled
              ? 'h-9 px-4 text-sm border-zinc-200 text-zinc-700 rounded disabled:opacity-40'
              : 'h-9 px-4 text-sm bg-zinc-900 hover:bg-zinc-800 text-white rounded disabled:opacity-40'
          }
        >
          {reminderSubmitting
            ? 'Saqlanmoqda...'
            : nasiya.reminderEnabled
              ? "Eslatmani o'chirish"
              : 'Eslatmani yoqish'}
        </Button>
      </div>

      {/* Passport photo */}
      <div className="border border-zinc-200 rounded overflow-hidden">
        <div className="px-4 py-3 bg-zinc-50 border-b border-zinc-200 font-semibold text-sm text-zinc-900">
          Pasport rasmi
        </div>
        <div className="p-4">
          {passportKey && passportUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={passportUrl}
              alt="Pasport rasmi"
              className="max-h-80 w-auto rounded border border-zinc-200"
            />
          ) : passportKey && !passportUrl ? (
            <div className="text-sm text-zinc-400">Yuklanmoqda...</div>
          ) : (
            <div className="text-sm text-zinc-400">Pasport rasmi yuklanmagan</div>
          )}
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
                <td className="px-4 py-3 text-zinc-700">{uzDate(row.dueDate)}</td>
                <td className="px-4 py-3 font-medium text-zinc-900">{fmt(row.expectedAmount)} so'm</td>
                <td className="px-4 py-3 text-zinc-700">{fmt(row.paidAmount)} so'm</td>
                <td className="px-4 py-3">
                  <RowBadge status={rowDisplayStatus(row)} />
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
                  <td className="px-4 py-3 text-zinc-700">{uzDate(payment.paidAt)}</td>
                  <td className="px-4 py-3 font-medium text-zinc-900">{fmt(payment.amount)} so'm</td>
                  <td className="px-4 py-3 text-zinc-700">{paymentMethodLabel(payment.paymentMethod)}</td>
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

      {/* Action logs */}
      <div className="border border-zinc-200 rounded overflow-hidden">
        <div className="px-4 py-3 bg-zinc-50 border-b border-zinc-200 font-semibold text-sm text-zinc-900">
          Amallar tarixi
        </div>
        {logs.length ? (
          <ul className="divide-y divide-zinc-100">
            {logs.map((l) => (
              <li key={l.id} className="px-4 py-3 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-sm text-zinc-900">{nasiyaLogLabel(l.action)}</div>
                  {l.note && <div className="text-xs text-zinc-500 mt-0.5">{l.note}</div>}
                </div>
                <div className="text-xs text-zinc-400 whitespace-nowrap flex-shrink-0">
                  {uzDateTime(l.createdAt)}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="px-4 py-6 text-sm text-zinc-500">Amallar tarixi yo'q</div>
        )}
      </div>

      {/* Payment Dialog */}
      <Dialog open={paymentModalOpen} onOpenChange={setPaymentModalOpen}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-xl gap-0 overflow-hidden rounded-xl p-0 sm:w-full">
          <DialogHeader className="border-b border-zinc-100 px-5 py-4">
            <DialogTitle className="text-base font-semibold text-zinc-900">To'lov qabul qilish</DialogTitle>
            <DialogDescription className="text-sm text-zinc-500">
              {nasiya.customer.name} · {nasiya.device.model}
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[65vh] space-y-4 overflow-y-auto px-5 py-4">
            {payError && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
                {payError}
              </div>
            )}

            {pendingSchedules.length > 0 && (
              <div className="space-y-2">
                <label className="block text-xs font-medium text-zinc-700">
                  Qaysi oy to'lovi? <span className="text-red-500">*</span>
                </label>
                <Select value={selectedScheduleId} onValueChange={(v) => v && setSelectedScheduleId(v)}>
                  <SelectTrigger className="h-11 w-full rounded-lg border-zinc-200 text-sm [&>span]:truncate">
                    <SelectValue placeholder="To'lov oyini tanlang">
                      {selectedSchedule ? scheduleTriggerLabel(selectedSchedule) : "To'lov oyini tanlang"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {pendingSchedules.map((s) => (
                      <SelectItem key={s.id} value={s.id} className="py-2">
                        <div className="flex flex-col gap-0.5">
                          <span className="font-medium text-zinc-900">
                            {s.monthNumber}-oy · {uzMonthYear(s.dueDate)}
                          </span>
                          <span className="text-xs text-zinc-500">
                            {uzDate(s.dueDate)} · qolgan {fmt(scheduleBalance(s))} so'm
                          </span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedSchedule && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="rounded-md border-zinc-200 bg-white text-zinc-600">
                        {scheduleStatusLabels[rowDisplayStatus(selectedSchedule)]}
                      </Badge>
                      <span className="text-xs text-zinc-500">Shu oy uchun qolgan</span>
                    </div>
                    <span className="text-sm font-semibold text-zinc-900">
                      {fmt(selectedScheduleOutstanding)} so'm
                    </span>
                  </div>
                )}
              </div>
            )}

            <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-zinc-200 px-3 py-2.5 hover:bg-zinc-50">
              <input
                type="checkbox"
                id="carry-over"
                checked={carryOver}
                onChange={(e) => setCarryOver(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-zinc-300"
              />
              <span className="text-sm text-zinc-700">
                Mijoz bu oy to'lamadi, muddatni uzaytirish
                <span className="mt-0.5 block text-xs text-zinc-400">
                  Belgilansa, to'lov emas — tanlangan oy keyingi sanaga suriladi.
                </span>
              </span>
            </label>

            {!carryOver && (
              <div className="space-y-2">
                <label className="block text-xs font-medium text-zinc-700">
                  Miqdor <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <Input
                    type="number"
                    inputMode="numeric"
                    value={payAmount}
                    onChange={(e) => setPayAmount(e.target.value)}
                    placeholder={selectedScheduleOutstanding ? String(selectedScheduleOutstanding) : '1000000'}
                    className="h-12 rounded-lg border-zinc-200 pr-14 text-lg font-semibold"
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-zinc-400">
                    so'm
                  </span>
                </div>
                {selectedScheduleOutstanding > 0 && (
                  <button
                    type="button"
                    onClick={() => setPayAmount(String(selectedScheduleOutstanding))}
                    className="text-xs font-medium text-zinc-500 underline-offset-2 hover:text-zinc-900 hover:underline"
                  >
                    Tavsiya: {fmt(selectedScheduleOutstanding)} so'm
                  </button>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {!carryOver && (
                <div className="space-y-2">
                  <label className="block text-xs font-medium text-zinc-700">
                    To'lov usuli <span className="text-red-500">*</span>
                  </label>
                  <Select value={payMethod} onValueChange={(v) => v && setPayMethod(v)}>
                    <SelectTrigger className="h-11 w-full rounded-lg border-zinc-200 text-sm">
                      <SelectValue placeholder="Usulni tanlang" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="CASH">Naqd</SelectItem>
                      <SelectItem value="CARD">Karta</SelectItem>
                      <SelectItem value="TRANSFER">Bank o'tkazmasi</SelectItem>
                      <SelectItem value="OTHER">Boshqa</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className={carryOver ? 'space-y-2 sm:col-span-2' : 'space-y-2'}>
                <label className="block text-xs font-medium text-zinc-700">
                  {carryOver ? "Yangi to'lov sanasi" : "To'lov sanasi"} <span className="text-red-500">*</span>
                </label>
                <Input
                  type="date"
                  value={payDate}
                  onChange={(e) => setPayDate(e.target.value)}
                  className="h-11 rounded-lg border-zinc-200 text-sm"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-medium text-zinc-700">
                Izoh <span className="text-red-500">*</span>
              </label>
              <Textarea
                value={payNote}
                onChange={(e) => setPayNote(e.target.value)}
                placeholder={carryOver ? "Masalan: mijoz 10 kunga kechiktirishni so'radi" : "Masalan: mijoz oylik to'lovni naqd berdi"}
                className="min-h-[80px] rounded-lg border-zinc-200 text-sm"
              />
            </div>
          </div>

          <DialogFooter className="gap-2 border-t border-zinc-100 px-5 py-4">
            <Button
              variant="outline"
              onClick={() => { setPaymentModalOpen(false); setPayError('') }}
              className="rounded-lg border-zinc-200 text-zinc-700"
            >
              Bekor qilish
            </Button>
            <Button
              disabled={!canSubmit || submitting}
              onClick={handlePaymentSubmit}
              className="rounded-lg bg-zinc-900 text-white hover:bg-zinc-800 disabled:opacity-40"
            >
              {submitting ? 'Saqlanmoqda...' : carryOver ? 'Muddatni uzaytirish' : "To'lovni saqlash"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit (safe fields) Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-md rounded-xl sm:w-full">
          <DialogHeader>
            <DialogTitle className="text-zinc-900">Nasiya izohini tahrirlash</DialogTitle>
            <DialogDescription className="text-sm text-zinc-500">
              Moliyaviy shartlar (summa, foiz, oylik) bu yerdan o'zgartirilmaydi — faqat izoh.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            {editError && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
                {editError}
              </div>
            )}
            <Textarea
              value={editNote}
              onChange={(e) => setEditNote(e.target.value)}
              placeholder="Nasiya bo'yicha izoh..."
              className="min-h-[100px] rounded-lg border-zinc-200 text-sm"
            />
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setEditOpen(false)}
              className="rounded-lg border-zinc-200 text-zinc-700"
            >
              Bekor qilish
            </Button>
            <Button
              disabled={editSaving}
              onClick={handleEditSave}
              className="rounded-lg bg-zinc-900 text-white hover:bg-zinc-800 disabled:opacity-40"
            >
              {editSaving ? 'Saqlanmoqda...' : 'Saqlash'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
