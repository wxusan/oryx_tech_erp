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
import { Progress } from '@/components/ui/progress'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { paymentMethodLabel } from '@/lib/labels'
import { scheduleDisplayStatus } from '@/lib/nasiya-utils'
import { formatMoneyByCurrency } from '@/lib/currency'
import { uzDate, uzDateTime } from '@/lib/dates'
import { useShopCurrency } from '@/lib/use-shop-currency'
import { NasiyaPaymentModal } from '@/components/shop/nasiya-payment-modal'
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
  newValue?: { oldDueDate?: string; newDueDate?: string; reminderEnabled?: boolean } | null
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
  displayStatus?: 'ACTIVE' | 'OVERDUE' | 'COMPLETED' | 'CANCELLED'
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
  paymentScore: {
    score: number
    label: string
    color: 'green' | 'yellow' | 'red' | 'gray'
    riskLevel: string
    reason: string
    factors: {
      overdueScheduleCount: number
      paidInstallmentCount: number
      earlyPaymentCount: number
      onTimePaymentCount: number
      latePaymentCount: number
      averageDaysEarlyLate: number
      maxDaysLate: number
      historyConfidence: string
    }
  }
}

const scoreCardStyles: Record<'green' | 'yellow' | 'red' | 'gray', string> = {
  green: 'bg-emerald-100 text-emerald-700',
  yellow: 'bg-amber-100 text-amber-700',
  red: 'bg-red-100 text-red-700',
  gray: 'bg-zinc-100 text-zinc-500',
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

function fmt(n: number, currency?: ReturnType<typeof useShopCurrency>['currency']) {
  if (currency) return formatMoneyByCurrency(n, currency.currency, currency.usdUzsRate)
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

function nasiyaLogLabel(log: NasiyaLog): string {
  const { action, newValue } = log
  if (action === 'CREATE_NASIYA') return 'Nasiya yaratildi'
  if (action === 'IMPORT_NASIYA') return 'Eski nasiya import qilindi'
  if (action === 'PAYMENT') return "To'lov qabul qilindi"
  if (action === 'NASIYA_DEFER') return 'Muddat uzaytirildi'
  if (action === 'NASIYA_COMPLETED') return 'Nasiya yakunlandi'
  if (action === 'UPDATE_REMINDER') {
    const enabled = (newValue as { reminderEnabled?: boolean } | null | undefined)?.reminderEnabled
    if (enabled === true) return 'Eslatma yoqildi'
    if (enabled === false) return "Eslatma o'chirildi"
    return "Eslatma o'zgartirildi"
  }
  if (action === 'UPDATE') return "Nasiya tahrirlandi"
  if (action === 'DELETE') return "O'chirildi"
  if (action === 'RETURN') return 'Qaytarildi'
  return action
}

/** Extra detail line under a log's title — currently only the defer old/new due dates. */
function nasiyaLogDetail(log: NasiyaLog): string | null {
  if (log.action === 'NASIYA_DEFER' && log.newValue?.oldDueDate && log.newValue?.newDueDate) {
    return `${uzDate(log.newValue.oldDueDate)} → ${uzDate(log.newValue.newDueDate)}`
  }
  return null
}

/**
 * Effective status shown for a schedule row. An unpaid row past its effective
 * due date reads as OVERDUE even before cron flips the stored status, so the
 * detail page agrees with the list and dashboard.
 */
function rowDisplayStatus(row: NasiyaSchedule): RowStatus {
  return scheduleDisplayStatus(row) as RowStatus
}

export default function NasiyaDetailPage() {
  const params = useParams()
  const id = params.id as string
  const { currency } = useShopCurrency()

  const [nasiya, setNasiya] = useState<Nasiya | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [passportUrl, setPassportUrl] = useState<string | null>(null)
  const [reminderSubmitting, setReminderSubmitting] = useState(false)
  const [logs, setLogs] = useState<NasiyaLog[]>([])

  const [paymentModalOpen, setPaymentModalOpen] = useState(false)

  const [editOpen, setEditOpen] = useState(false)
  const [editCustomerName, setEditCustomerName] = useState('')
  const [editCustomerPhone, setEditCustomerPhone] = useState('')
  const [editNote, setEditNote] = useState('')
  const [editImportNote, setEditImportNote] = useState('')
  const [editReminderEnabled, setEditReminderEnabled] = useState(true)
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState('')

  const fetchNasiya = useCallback(() => {
    if (!id) return
    fetch(`/api/nasiya/${id}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.success) {
          setNasiya(json.data)
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
    setEditCustomerName(nasiya?.customer.name ?? '')
    setEditCustomerPhone(nasiya?.customer.phone ?? '')
    setEditNote(nasiya?.note ?? '')
    setEditImportNote(nasiya?.importNote ?? '')
    setEditReminderEnabled(nasiya?.reminderEnabled ?? true)
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
        body: JSON.stringify({
          customerName: editCustomerName.trim(),
          customerPhone: editCustomerPhone.trim(),
          note: editNote.trim(),
          importNote: nasiya.isImported ? editImportNote.trim() : undefined,
          reminderEnabled: editReminderEnabled,
          reason: editNote.trim() || editImportNote.trim() || "Nasiya ma'lumotlari tuzatildi",
        }),
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

  // Server-derived (src/lib/nasiya-utils.ts deriveNasiyaOverdue) so this page
  // can never disagree with the nasiyalar list about completed/overdue state
  // — falls back to the raw stored status only if an older API response
  // didn't include it yet.
  const displayStatus = nasiya.displayStatus ?? (nasiya.status as 'ACTIVE' | 'OVERDUE' | 'COMPLETED' | 'CANCELLED')
  const isCompleted = displayStatus === 'COMPLETED'
  const statusBadgeStyles: Record<string, string> = {
    ACTIVE: 'bg-zinc-100 text-zinc-700',
    OVERDUE: 'bg-red-100 text-red-700',
    COMPLETED: 'bg-emerald-100 text-emerald-700',
    CANCELLED: 'bg-zinc-200 text-zinc-500',
  }
  const statusBadgeLabels: Record<string, string> = {
    ACTIVE: 'Faol',
    OVERDUE: "Muddati o'tgan",
    COMPLETED: 'Yakunlangan',
    CANCELLED: 'Bekor qilingan',
  }

  return (
    <div className="p-6 space-y-5 max-w-4xl">
      <Link href="/shop/nasiyalar" className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900">
        <ArrowLeft size={14} />
        Nasiyalarga qaytish
      </Link>

      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-zinc-900">{nasiya.customer.name}</h1>
            <span className={`inline-block px-2.5 py-1 rounded text-xs font-medium ${statusBadgeStyles[displayStatus]}`}>
              {statusBadgeLabels[displayStatus]}
            </span>
          </div>
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
          {!isCompleted && displayStatus !== 'CANCELLED' && (
            <Button
              onClick={() => setPaymentModalOpen(true)}
              className="h-9 px-4 text-sm bg-zinc-900 hover:bg-zinc-800 text-white rounded"
            >
              To'lov qabul qilish
            </Button>
          )}
        </div>
      </div>

      {isCompleted && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
          <div className="text-sm font-semibold text-emerald-900">Bu nasiya to'liq yopilgan.</div>
          <div className="text-xs text-emerald-800/80 mt-0.5">
            Qurilma sotilgan/nasiyadagi holatida qoladi — omborga qaytarilmaydi.
          </div>
        </div>
      )}

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
            <ImportField label="Eski nasiya summasi" value={fmt(nasiya.originalTotalAmount ?? 0, currency)} />
            <ImportField label="Importgacha to'langan" value={fmt(nasiya.alreadyPaidBeforeImport ?? 0, currency)} />
            <ImportField label="Import paytidagi qarz" value={fmt(nasiya.remainingAtImport ?? 0, currency)} />
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
          // Jami narx -> Boshlang'ich to'lov -> Nasiya jami (original financed
          // amount) -> To'langan -> Qarz qoldig'i (CURRENT remaining debt).
          // These are deliberately two different numbers — no separate
          // "Qolgan summa" card, which duplicated one or the other and read
          // as a confusing third figure (see docs/nasiya-payment-allocation.md).
          { label: 'Jami narx', value: fmt(nasiya.totalAmount, currency) },
          { label: "Boshlang'ich to'lov", value: fmt(nasiya.downPayment, currency) },
          ...(nasiya.interestAmount > 0
            ? [
                { label: 'Nasiya foizi', value: `${fmt(nasiya.interestPercent)}%` },
                { label: 'Foiz summasi', value: fmt(nasiya.interestAmount, currency) },
              ]
            : []),
          { label: 'Nasiya jami', value: fmt(nasiya.finalNasiyaAmount, currency) },
          { label: "To'langan", value: fmt(paidAmount, currency) },
          { label: "Qarz qoldig'i", value: fmt(nasiya.remainingAmount, currency) },
          { label: "Oylik to'lov", value: fmt(monthlyPayment, currency) },
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
          <CardDescription>
            {isCompleted ? "Nasiya to'liq yopilgan" : "Nasiya bo'yicha jami to'langan summa"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex justify-between text-sm mb-2">
            <span className="text-zinc-600 font-medium">{fmt(paidAmount, currency)} to'landi</span>
            <span className="font-bold text-zinc-900">{pct}%</span>
          </div>
          <Progress value={pct} className="h-2.5 rounded-full" />
          <div className="flex justify-between text-xs text-zinc-400 mt-1.5">
            <span>{fmt(0, currency)}</span>
            <span>{fmt(nasiya.finalNasiyaAmount, currency)}</span>
          </div>
        </CardContent>
      </Card>

      {/* Payment behavior score — retitled "historical" once completed so it never
          reads as an active/current risk signal for a nasiya with no debt left. */}
      <Card className="rounded-lg">
        <CardHeader>
          <CardTitle>{isCompleted ? "To'lov tarixi bahosi" : "To'lov ishonchi"}</CardTitle>
          <CardDescription>
            {isCompleted
              ? "Yakunlangan nasiya bo'yicha tarixiy to'lov xatti-harakati"
              : "Mijozning to'lov tarixiga asoslangan baho"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3">
            <span
              className={`inline-block px-2.5 py-1 rounded text-sm font-medium ${scoreCardStyles[nasiya.paymentScore.color]}`}
            >
              {nasiya.paymentScore.label}
            </span>
            <span className="text-sm font-bold text-zinc-900">{nasiya.paymentScore.score}/100</span>
          </div>
          <p className="text-sm text-zinc-600">{nasiya.paymentScore.reason}</p>
          <div className="grid grid-cols-2 gap-2 text-xs text-zinc-500 sm:grid-cols-4">
            <div>Vaqtida: {nasiya.paymentScore.factors.earlyPaymentCount + nasiya.paymentScore.factors.onTimePaymentCount}</div>
            <div>Kechikkan: {nasiya.paymentScore.factors.latePaymentCount}</div>
            <div>Muddati o'tgan: {nasiya.paymentScore.factors.overdueScheduleCount}</div>
            <div>Ishonch: {nasiya.paymentScore.factors.historyConfidence}</div>
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
                <td className="px-4 py-3 font-medium text-zinc-900">{fmt(row.expectedAmount, currency)}</td>
                <td className="px-4 py-3 text-zinc-700">{fmt(row.paidAmount, currency)}</td>
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
                  <td className="px-4 py-3 font-medium text-zinc-900">{fmt(payment.amount, currency)}</td>
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
                  <div className="text-sm text-zinc-900">{nasiyaLogLabel(l)}</div>
                  {nasiyaLogDetail(l) && <div className="text-xs text-zinc-500 mt-0.5">{nasiyaLogDetail(l)}</div>}
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

      {/* Payment modal — shared component, also used on the nasiyalar list */}
      <NasiyaPaymentModal
        nasiyaId={nasiya.id}
        open={paymentModalOpen}
        onOpenChange={setPaymentModalOpen}
        customerName={nasiya.customer.name}
        deviceName={nasiya.device.model}
        onSuccess={() => { setLoading(true); fetchNasiya() }}
      />

      {/* Edit (safe fields) Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-md rounded-xl sm:w-full">
          <DialogHeader>
            <DialogTitle className="text-zinc-900">Nasiya ma'lumotlarini tahrirlash</DialogTitle>
            <DialogDescription className="text-sm text-zinc-500">
              Pul summalari to'lovlar va hisobotlarga bog'langan. Ularni tuzatish uchun alohida adjustment kerak.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            {editError && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
                {editError}
              </div>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-zinc-700">Mijoz ismi</label>
                <Input
                  value={editCustomerName}
                  onChange={(e) => setEditCustomerName(e.target.value)}
                  className="h-9 rounded-lg border-zinc-200 text-sm"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-zinc-700">Telefon</label>
                <Input
                  value={editCustomerPhone}
                  onChange={(e) => setEditCustomerPhone(e.target.value)}
                  className="h-9 rounded-lg border-zinc-200 text-sm"
                />
              </div>
            </div>
            <Textarea
              value={editNote}
              onChange={(e) => setEditNote(e.target.value)}
              placeholder="Nasiya bo'yicha izoh..."
              className="min-h-[100px] rounded-lg border-zinc-200 text-sm"
            />
            {nasiya?.isImported && (
              <Textarea
                value={editImportNote}
                onChange={(e) => setEditImportNote(e.target.value)}
                placeholder="Import izohi..."
                className="min-h-[80px] rounded-lg border-zinc-200 text-sm"
              />
            )}
            <label className="flex items-start gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-700">
              <input
                type="checkbox"
                checked={editReminderEnabled}
                onChange={(e) => setEditReminderEnabled(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-zinc-300"
              />
              <span>Eslatma yoqilgan</span>
            </label>
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
