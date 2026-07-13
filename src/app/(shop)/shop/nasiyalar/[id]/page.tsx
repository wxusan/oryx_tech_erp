'use client'

import { useState, useEffect, useCallback } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { commitNavigationMutation } from '@/lib/client-events'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PhoneInput } from '@/components/ui/phone-input'
import { formatUzPhoneDisplay } from '@/lib/phone'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { formatMoneyByCurrency } from '@/lib/currency'
import { formatDisplayMoneyFromContract } from '@/lib/nasiya-contract'
import { uzDate } from '@/lib/dates'
import { useShopCurrency } from '@/lib/use-shop-currency'
import { NasiyaPaymentModal } from '@/components/shop/nasiya-payment-modal'
import { NasiyaDeferModal } from '@/components/shop/nasiya-defer-modal'
import { TrustBadge } from '@/components/shop/trust-badge'
import { ArrowLeft, Pencil } from 'lucide-react'
import type { NasiyaPaymentDisplayRecord } from '@/lib/payment-history-display'
import {
  NasiyaHistorySections,
  type NasiyaActionLog as NasiyaLog,
  type NasiyaScheduleRow as NasiyaSchedule,
} from '@/components/shop/nasiya-history-sections'
import { ShopAccessDenied, useShopAccess } from '@/components/shop/shop-access-context'
import { useLogicalCommandIdempotency } from '@/lib/use-logical-command-idempotency'

type NasiyaPayment = NasiyaPaymentDisplayRecord
type ResolutionState = 'ACTIVE' | 'ARCHIVED' | 'WRITTEN_OFF'
type ResolutionAction = 'ARCHIVE' | 'WRITE_OFF' | 'REOPEN'

interface ResolutionEvent {
  id: string
  eventType: ResolutionAction
  previousState: ResolutionState
  newState: ResolutionState
  contractCurrency: 'UZS' | 'USD'
  nativeRemainingAmount: number
  frozenUzsAmount: number
  frozenUsdUzsRate: number
  reason: string
  actorId: string
  actorType: string
  reversesEventId: string | null
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
  // Native contract-currency ledger — the deal's own frozen currency, source
  // of truth for debt/schedule math. See docs/currency-accounting-model.md.
  contractCurrency: 'UZS' | 'USD'
  contractTotalAmount: number
  contractDownPayment: number
  contractInterestAmount: number
  contractFinalAmount: number
  contractMonthlyPayment: number
  contractRemainingAmount: number
  contractPaidAmount: number
  status: string
  resolutionState: ResolutionState
  resolutionUpdatedAt: string | null
  resolutionEvents: ResolutionEvent[]
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
  customer: { id: string; name: string; phone: string; hasPassportPhoto: boolean }
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
  customerTrust?: {
    tier: 'NEW' | 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH'
    label: string
    color: 'gray' | 'red' | 'yellow' | 'green' | 'emerald'
    reasons: string[]
  }
}

const scoreCardStyles: Record<'green' | 'yellow' | 'red' | 'gray', string> = {
  green: 'bg-emerald-100 text-emerald-700',
  yellow: 'bg-amber-100 text-amber-700',
  red: 'bg-red-100 text-red-700',
  gray: 'bg-zinc-100 text-zinc-500',
}

const historyConfidenceLabels: Record<string, string> = {
  LOW: 'Past',
  MEDIUM: "O'rtacha",
  HIGH: 'Yuqori',
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

export default function NasiyaDetailPage() {
  const { can } = useShopAccess()
  if (!can('NASIYA_VIEW')) return <ShopAccessDenied />
  return <AuthorizedNasiyaDetailPage />
}

function AuthorizedNasiyaDetailPage() {
  const { can } = useShopAccess()
  const canManageNasiya = can('NASIYA_MANAGE')
  const canReceivePayment = can('PAYMENT_RECEIVE')
  const canResolveNasiya = can('WRITEOFF_MANAGE')
  const resolutionCommand = useLogicalCommandIdempotency()
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
  const [deferModalOpen, setDeferModalOpen] = useState(false)
  const [resolutionAction, setResolutionAction] = useState<ResolutionAction | null>(null)
  const [resolutionReason, setResolutionReason] = useState('')
  const [resolutionError, setResolutionError] = useState('')
  const [resolutionSubmitting, setResolutionSubmitting] = useState(false)

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

  // Fetch through the tenant-scoped customer endpoint; the private storage
  // key never enters browser state, URLs, logs, or query caches.
  const passportCustomerId = nasiya?.customer?.id ?? null
  const hasPassportPhoto = nasiya?.customer?.hasPassportPhoto ?? false
  useEffect(() => {
    if (!passportCustomerId || !hasPassportPhoto) return
    let cancelled = false
    fetch(`/api/customers/${encodeURIComponent(passportCustomerId)}/passport/image`)
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
  }, [hasPassportPhoto, passportCustomerId])

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
      if (res.ok && json.success) {
        await commitNavigationMutation({
          kind: 'nasiya.updated',
          nasiyaId: nasiya.id,
        })
        setEditOpen(false)
        fetchNasiya()
      } else {
        setEditError(json.error || 'Saqlashda xatolik')
      }
    } catch {
      setEditError('Saqlashda xatolik')
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
      if (res.ok && json.success) {
        await commitNavigationMutation({
          kind: 'nasiya.reminderUpdated',
          nasiyaId: nasiya.id,
        })
        fetchNasiya()
      }
    } catch {
      // silent — state is re-derived from server on next fetch
    } finally {
      setReminderSubmitting(false)
    }
  }

  function openResolution(action: ResolutionAction) {
    setResolutionAction(action)
    setResolutionReason('')
    setResolutionError('')
  }

  async function handleResolution() {
    if (!nasiya || !resolutionAction || resolutionSubmitting || resolutionReason.trim().length < 5) return
    const payload = { action: resolutionAction, reason: resolutionReason.trim() }
    setResolutionSubmitting(true)
    setResolutionError('')
    try {
      const response = await fetch(`/api/nasiya/${nasiya.id}/resolution`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': resolutionCommand.keyFor(payload),
        },
        body: JSON.stringify(payload),
      })
      const json = await response.json()
      if (!response.ok || !json.success) {
        resolutionCommand.rejected(response.status)
        setResolutionError(json.error || "Holatni o'zgartirishda xatolik")
        return
      }
      resolutionCommand.committed()
      const kind = resolutionAction === 'ARCHIVE'
        ? 'nasiya.archived'
        : resolutionAction === 'WRITE_OFF'
          ? 'nasiya.writtenOff'
          : 'nasiya.reopened'
      await commitNavigationMutation({ kind, nasiyaId: nasiya.id })
      setResolutionAction(null)
      setLoading(true)
      fetchNasiya()
    } catch {
      setResolutionError("Holatni o'zgartirishda xatolik")
    } finally {
      setResolutionSubmitting(false)
    }
  }

  if (loading) {
    return <div className="p-6 text-sm text-zinc-400">Yuklanmoqda...</div>
  }

  if (error || !nasiya) {
    return (
      <div className="p-6">
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-4 py-3">{error || 'Nasiya topilmadi'}</div>
      </div>
    )
  }

  // Progress must use the contract ledger too. Legacy UZS paid/remaining can
  // reach their apparent endpoint at a different FX rate while contract debt
  // still exists, which would otherwise render a misleading 100% bar.
  const pct = nasiya.contractFinalAmount > 0 ? Math.min(100, Math.round((nasiya.contractPaidAmount / nasiya.contractFinalAmount) * 100)) : 0
  // Contract-currency figures for the summary cards below — a nasiya's
  // "current state" (jami/qoldiq/to'langan/oylik) must convert from its OWN
  // contract currency using TODAY's rate, never reconvert the frozen-rate
  // legacy UZS snapshot a second time (that would silently drift from the
  // true contract value as the rate moves). See docs/currency-accounting-model.md.
  const contractMonthlyPayment = nasiya.schedules?.length > 0 ? nasiya.schedules[0].contractExpectedAmount : nasiya.contractMonthlyPayment
  const dfmt = (n: number) => formatDisplayMoneyFromContract(n, nasiya.contractCurrency, currency.currency, currency.usdUzsRate)


  // Server-derived (src/lib/nasiya-contract-status.ts) so this page
  // can never disagree with the nasiyalar list about completed/overdue state
  // — falls back to the raw stored status only if an older API response
  // didn't include it yet.
  const displayStatus = nasiya.displayStatus ?? (nasiya.status as 'ACTIVE' | 'OVERDUE' | 'COMPLETED' | 'CANCELLED')
  const isCompleted = displayStatus === 'COMPLETED'
  const isOperationallyActive = nasiya.resolutionState === 'ACTIVE'
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
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold text-zinc-900">{nasiya.customer.name}</h1>
            <span className={`inline-block px-2.5 py-1 rounded text-xs font-medium ${statusBadgeStyles[displayStatus]}`}>
              {statusBadgeLabels[displayStatus]}
            </span>
            {nasiya.resolutionState !== 'ACTIVE' && (
              <span className={`inline-block rounded px-2.5 py-1 text-xs font-medium ${
                nasiya.resolutionState === 'WRITTEN_OFF'
                  ? 'bg-red-100 text-red-800'
                  : 'bg-blue-100 text-blue-800'
              }`}>
                {nasiya.resolutionState === 'WRITTEN_OFF' ? 'Hisobdan chiqarilgan' : 'Arxivlangan'}
              </span>
            )}
            {nasiya.customerTrust && <TrustBadge trust={nasiya.customerTrust} />}
          </div>
          <p className="text-sm text-zinc-500 mt-0.5">
            {nasiya.device.model} · {formatUzPhoneDisplay(nasiya.customer.phone)}
          </p>
          {nasiya.customerTrust && nasiya.customerTrust.reasons.length > 0 && (
            <p className="text-xs text-zinc-400 mt-1">{nasiya.customerTrust.reasons.join(' · ')}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {canManageNasiya && (
            <Button variant="outline" onClick={openEdit} className="h-9 px-3 text-sm border-zinc-200 text-zinc-700 hover:bg-zinc-50 rounded">
              <Pencil size={14} />
              Tahrirlash
            </Button>
          )}
          {canManageNasiya && isOperationallyActive && !isCompleted && displayStatus !== 'CANCELLED' && (
            <Button variant="outline" onClick={() => setDeferModalOpen(true)} className="h-9 px-3 text-sm border-zinc-200 text-zinc-700 hover:bg-zinc-50 rounded">
              Muddatni uzaytirish
            </Button>
          )}
          {canReceivePayment && isOperationallyActive && !isCompleted && displayStatus !== 'CANCELLED' && (
            <Button onClick={() => setPaymentModalOpen(true)} className="h-9 px-4 text-sm bg-zinc-900 hover:bg-zinc-800 text-white rounded">
              To'lov qabul qilish
            </Button>
          )}
          {canResolveNasiya && displayStatus !== 'CANCELLED' && (
            <>
              {nasiya.resolutionState === 'ACTIVE' && (
                <Button variant="outline" onClick={() => openResolution('ARCHIVE')} className="h-9 px-3 text-sm border-zinc-200 rounded">
                  Arxivlash
                </Button>
              )}
              {nasiya.resolutionState !== 'WRITTEN_OFF' && nasiya.contractRemainingAmount > 0 && (
                <Button variant="destructive" onClick={() => openResolution('WRITE_OFF')} className="h-9 px-3 text-sm rounded">
                  Hisobdan chiqarish
                </Button>
              )}
              {nasiya.resolutionState !== 'ACTIVE' && (
                <Button variant="outline" onClick={() => openResolution('REOPEN')} className="h-9 px-3 text-sm border-zinc-200 rounded">
                  Qayta ochish
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {nasiya.resolutionState === 'ARCHIVED' && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
          Bu nasiya ish navbatidan arxivlangan. Moliyaviy qoldiq o'zgarmagan; qayta ochilmaguncha to'lov va muddat uzaytirish yopiq.
        </div>
      )}
      {nasiya.resolutionState === 'WRITTEN_OFF' && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          Bu qarz hisobdan chiqarilgan. Tarix va qoldiq dalillari saqlangan, lekin kelajakdagi undirish, muddati o'tgan hisob va eslatmalar to'xtatilgan.
        </div>
      )}

      {isCompleted && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
          <div className="text-sm font-semibold text-emerald-900">Bu nasiya to'liq yopilgan.</div>
          <div className="text-xs text-emerald-800/80 mt-0.5">Qurilma sotilgan/nasiyadagi holatida qoladi — omborga qaytarilmaydi.</div>
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
            <span className="inline-block rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">Eski nasiya</span>
            <span className="text-sm font-semibold text-amber-900">Import qilingan nasiya</span>
          </div>
          <p className="mt-1 text-xs text-amber-800/80">
            Bu Oryx'dan oldingi eski nasiya. Importgacha to'langan pul joriy oy daromadiga qo'shilmaydi.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
            <ImportField label="Manba" value={nasiya.importSource === 'MANUAL' ? "Qo'lda" : (nasiya.importSource ?? '—')} />
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
          // Sotilish narxi -> Boshlang'ich to'lov -> Nasiya jami (original
          // financed amount) -> To'langan -> Qarz qoldig'i (CURRENT remaining
          // debt). These are deliberately two different numbers — no separate
          // "Qolgan summa" card, which duplicated one or the other and read
          // as a confusing third figure (see docs/nasiya-payment-allocation.md).
          // All values below convert from the deal's OWN contract currency
          // using today's rate (dfmt) — never reconvert the frozen-creation-
          // rate legacy UZS snapshot, which would drift from the true
          // contract value as the rate moves (see
          // docs/currency-accounting-model.md).
          { label: 'Sotilish narxi', value: dfmt(nasiya.contractTotalAmount) },
          {
            label: "Boshlang'ich to'lov",
            value: dfmt(nasiya.contractDownPayment),
          },
          ...(nasiya.contractInterestAmount > 0
            ? [
                {
                  label: 'Nasiya foizi',
                  value: `${fmt(nasiya.interestPercent)}%`,
                },
                {
                  label: 'Foiz summasi',
                  value: dfmt(nasiya.contractInterestAmount),
                },
              ]
            : []),
          { label: 'Nasiya jami', value: dfmt(nasiya.contractFinalAmount) },
          { label: "To'langan", value: dfmt(nasiya.contractPaidAmount) },
          {
            label: "Qarz qoldig'i",
            value: dfmt(nasiya.contractRemainingAmount),
          },
          { label: "Oylik to'lov", value: dfmt(contractMonthlyPayment) },
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
          <CardDescription>{isCompleted ? "Nasiya to'liq yopilgan" : "Nasiya bo'yicha jami to'langan summa"}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex justify-between text-sm mb-2">
            <span className="text-zinc-600 font-medium">{dfmt(nasiya.contractPaidAmount)} to'landi</span>
            <span className="font-bold text-zinc-900">{pct}%</span>
          </div>
          <Progress value={pct} className="h-2.5 rounded-full" />
          <div className="flex justify-between text-xs text-zinc-400 mt-1.5">
            <span>{dfmt(0)}</span>
            <span>{dfmt(nasiya.contractFinalAmount)}</span>
          </div>
        </CardContent>
      </Card>

      {/* Payment behavior score — retitled "historical" once completed so it never
          reads as an active/current risk signal for a nasiya with no debt left. */}
      <Card className="rounded-lg">
        <CardHeader>
          <CardTitle>{isCompleted ? "To'lov tarixi bahosi" : "To'lov ishonchi"}</CardTitle>
          <CardDescription>
            {isCompleted ? "Yakunlangan nasiya bo'yicha tarixiy to'lov xatti-harakati" : "Mijozning to'lov tarixiga asoslangan baho"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3">
            <span className={`inline-block px-2.5 py-1 rounded text-sm font-medium ${scoreCardStyles[nasiya.paymentScore.color]}`}>
              {nasiya.paymentScore.label}
            </span>
            <span className="text-sm font-bold text-zinc-900">{nasiya.paymentScore.score}/100</span>
          </div>
          <p className="text-sm text-zinc-600">{nasiya.paymentScore.reason}</p>
          <div className="grid grid-cols-2 gap-2 text-xs text-zinc-500 sm:grid-cols-4">
            <div>Vaqtida: {nasiya.paymentScore.factors.earlyPaymentCount + nasiya.paymentScore.factors.onTimePaymentCount}</div>
            <div>Kechikkan: {nasiya.paymentScore.factors.latePaymentCount}</div>
            <div>Muddati o'tgan: {nasiya.paymentScore.factors.overdueScheduleCount}</div>
            <div>Ishonch: {historyConfidenceLabels[nasiya.paymentScore.factors.historyConfidence] ?? "Noma'lum"}</div>
          </div>
        </CardContent>
      </Card>

      {/* Reminder toggle */}
      <div className="border border-zinc-200 rounded p-4 flex items-center justify-between gap-4">
        <div>
          <div className="text-sm font-semibold text-zinc-900">To'lov eslatmasi</div>
          <div className="text-xs text-zinc-500 mt-0.5">
            {!isOperationallyActive
              ? "Arxiv/hisobdan chiqarish holatida eslatmalar yuborilmaydi"
              : nasiya.reminderEnabled ? 'Eslatma yoqilgan' : "Eslatma o'chirilgan"}
          </div>
        </div>
        {canManageNasiya && isOperationallyActive && (
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
            {reminderSubmitting ? 'Saqlanmoqda...' : nasiya.reminderEnabled ? "Eslatmani o'chirish" : 'Eslatmani yoqish'}
          </Button>
        )}
      </div>

      {nasiya.resolutionEvents.length > 0 && (
        <Card className="rounded-lg">
          <CardHeader>
            <CardTitle>Undirish holati tarixi</CardTitle>
            <CardDescription>O'zgarmas arxiv, hisobdan chiqarish va qayta ochish dalillari</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {nasiya.resolutionEvents.map((event) => (
              <div key={event.id} className="rounded-lg border border-zinc-200 p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-zinc-900">
                    {event.eventType === 'WRITE_OFF'
                      ? 'Hisobdan chiqarildi'
                      : event.eventType === 'ARCHIVE'
                        ? 'Arxivlandi'
                        : 'Qayta ochildi'}
                  </span>
                  <span className="text-xs text-zinc-500">{uzDate(event.createdAt)}</span>
                </div>
                <div className="mt-1 text-xs text-zinc-500">
                  {event.previousState} → {event.newState} · {event.nativeRemainingAmount.toLocaleString('ru-RU')} {event.contractCurrency}
                  {' · '}muzlatilgan UZS: {event.frozenUzsAmount.toLocaleString('ru-RU')}
                </div>
                <p className="mt-2 whitespace-pre-wrap text-zinc-700">{event.reason}</p>
                {event.reversesEventId && (
                  <p className="mt-1 text-xs text-zinc-400">Qoplovchi hodisa: {event.reversesEventId}</p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Passport photo */}
      <div className="border border-zinc-200 rounded overflow-hidden">
        <div className="px-4 py-3 bg-zinc-50 border-b border-zinc-200 font-semibold text-sm text-zinc-900">Pasport rasmi</div>
        <div className="p-4">
          {hasPassportPhoto && passportUrl ? (
            <div className="relative aspect-[4/3] max-h-80 w-full overflow-hidden rounded border border-zinc-200 bg-zinc-50">
              <Image src={passportUrl} alt="Pasport rasmi" fill sizes="(max-width: 640px) 100vw, 720px" unoptimized className="object-contain" />
            </div>
          ) : hasPassportPhoto && !passportUrl ? (
            <div className="text-sm text-zinc-400">Yuklanmoqda...</div>
          ) : (
            <div className="text-sm text-zinc-400">Pasport rasmi yuklanmagan</div>
          )}
        </div>
      </div>

      <NasiyaHistorySections
        schedules={nasiya.schedules ?? []}
        payments={nasiya.payments ?? []}
        logs={logs}
        contractCurrency={nasiya.contractCurrency}
        currency={currency}
        formatContractAmount={dfmt}
      />

      {/* Payment modal — shared component, also used on the nasiyalar list */}
      {canReceivePayment && isOperationallyActive && (
        <NasiyaPaymentModal
          nasiyaId={nasiya.id}
          open={paymentModalOpen}
          onOpenChange={setPaymentModalOpen}
          customerName={nasiya.customer.name}
          deviceName={nasiya.device.model}
          onSuccess={() => {
            setLoading(true)
            fetchNasiya()
          }}
        />
      )}

      {canManageNasiya && isOperationallyActive && (
        <NasiyaDeferModal
          nasiyaId={nasiya.id}
          open={deferModalOpen}
          onOpenChange={setDeferModalOpen}
          customerName={nasiya.customer.name}
          deviceName={nasiya.device.model}
          onSuccess={() => {
            setLoading(true)
            fetchNasiya()
          }}
        />
      )}

      <Dialog open={resolutionAction !== null} onOpenChange={(open) => { if (!open) setResolutionAction(null) }}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-md rounded-xl sm:w-full">
          <DialogHeader>
            <DialogTitle>
              {resolutionAction === 'WRITE_OFF'
                ? 'Qarzni hisobdan chiqarish'
                : resolutionAction === 'ARCHIVE'
                  ? 'Nasiyani arxivlash'
                  : 'Nasiyani qayta ochish'}
            </DialogTitle>
            <DialogDescription>
              {resolutionAction === 'WRITE_OFF'
                ? `Qoldiq ${dfmt(nasiya.contractRemainingAmount)}. Bu amal moliyaviy tarixni o'chirmaydi, lekin kelajakdagi undirish va eslatmalarni to'xtatadi.`
                : resolutionAction === 'ARCHIVE'
                  ? "Moliyaviy qoldiq o'zgarmaydi; nasiya oddiy ish navbatidan olinadi."
                  : "Oldingi hodisa o'chirilmaydi. Alohida qoplovchi qayta ochish hodisasi yoziladi."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {resolutionError && (
              <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
                {resolutionError}
              </div>
            )}
            <div>
              <label htmlFor="nasiya-resolution-reason" className="mb-1.5 block text-xs font-medium text-zinc-700">
                Sabab <span className="text-red-500">*</span>
              </label>
              <Textarea
                id="nasiya-resolution-reason"
                value={resolutionReason}
                onChange={(event) => setResolutionReason(event.target.value)}
                placeholder="Kamida 5 ta belgi bilan aniq sabab yozing"
                className="min-h-24 rounded-lg border-zinc-200"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setResolutionAction(null)}>Bekor qilish</Button>
            <Button
              variant={resolutionAction === 'WRITE_OFF' ? 'destructive' : 'default'}
              disabled={resolutionSubmitting || resolutionReason.trim().length < 5}
              onClick={handleResolution}
            >
              {resolutionSubmitting
                ? 'Saqlanmoqda...'
                : resolutionAction === 'WRITE_OFF'
                  ? 'Hisobdan chiqarishni tasdiqlash'
                  : resolutionAction === 'ARCHIVE'
                    ? 'Arxivlash'
                    : 'Qayta ochish'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
            {editError && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{editError}</div>}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="nasiya-edit-customer" className="mb-1.5 block text-xs font-medium text-zinc-700">Mijoz ismi</label>
                <Input
                  id="nasiya-edit-customer"
                  value={editCustomerName}
                  onChange={(e) => setEditCustomerName(e.target.value)}
                  className="h-9 rounded-lg border-zinc-200 text-sm"
                />
              </div>
              <div>
                <label htmlFor="nasiya-edit-phone" className="mb-1.5 block text-xs font-medium text-zinc-700">Telefon</label>
                <PhoneInput
                  id="nasiya-edit-phone"
                  value={editCustomerPhone}
                  onChange={setEditCustomerPhone}
                  className="h-9 rounded-lg border-zinc-200 text-sm"
                />
              </div>
            </div>
            <Textarea
              aria-label="Nasiya izohi"
              value={editNote}
              onChange={(e) => setEditNote(e.target.value)}
              placeholder="Nasiya bo'yicha izoh..."
              className="min-h-[100px] rounded-lg border-zinc-200 text-sm"
            />
            {nasiya?.isImported && (
              <Textarea
                aria-label="Import izohi"
                value={editImportNote}
                onChange={(e) => setEditImportNote(e.target.value)}
                placeholder="Import izohi..."
                className="min-h-[80px] rounded-lg border-zinc-200 text-sm"
              />
            )}
            <label htmlFor="edit-nasiya-reminder" className="flex items-start gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-700">
              <input
                id="edit-nasiya-reminder"
                type="checkbox"
                checked={editReminderEnabled}
                onChange={(e) => setEditReminderEnabled(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-zinc-300"
              />
              <span>Eslatma yoqilgan</span>
            </label>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setEditOpen(false)} className="rounded-lg border-zinc-200 text-zinc-700">
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
