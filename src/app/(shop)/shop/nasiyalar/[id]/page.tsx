'use client'

import { useState, useEffect, useCallback } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { commitNavigationMutation } from '@/lib/client-events'
import { Button } from '@/components/ui/button'
import { AsyncButton } from '@/components/ui/async-button'
import { Input } from '@/components/ui/input'
import { PhoneInput } from '@/components/ui/phone-input'
import { formatUzPhoneDisplay, isValidPhone } from '@/lib/phone'
import { Textarea } from '@/components/ui/textarea'
import { Field } from '@/components/ui/field'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { addMoneyDto, convertMoneyDto, formatMoneyDto, subtractMoneyDto, type FxQuoteDto, type MoneyDto } from '@/lib/currency'
import { uzDate } from '@/lib/dates'
import { useShopCurrency } from '@/lib/use-shop-currency'
import { NasiyaPaymentModal } from '@/components/shop/nasiya-payment-modal'
import { NasiyaDeferModal } from '@/components/shop/nasiya-defer-modal'
import { NasiyaSettlementModal } from '@/components/shop/nasiya-settlement-modal'
import { NasiyaReturnModal } from '@/components/shop/nasiya-return-modal'
import { TrustBadge } from '@/components/shop/trust-badge'
import { ArrowLeft, Pencil, RotateCcw } from 'lucide-react'
import type { NasiyaPaymentDisplayRecord } from '@/lib/payment-history-display'
import {
  NasiyaHistorySections,
  type NasiyaActionLog as NasiyaLog,
  type NasiyaScheduleRow as NasiyaSchedule,
} from '@/components/shop/nasiya-history-sections'
import { ShopAccessDenied, useShopAccess } from '@/components/shop/shop-access-context'
import { useLogicalCommandIdempotency } from '@/lib/use-logical-command-idempotency'
import type { NasiyaLedgerDto } from '@/lib/nasiya-ledger'
import type {
  NasiyaSettlementMutationResult,
  NasiyaSettlementQuote,
  NasiyaSettlementRecordDto,
} from '@/lib/nasiya-settlement'
import type {
  NasiyaDeferMutationResult,
  NasiyaOperationContext,
  NasiyaPaymentMutationResult,
} from '@/lib/nasiya-operation-context'
import type {
  NasiyaReturnMutationResult,
  NasiyaReturnQuoteDto,
  NasiyaReturnRecordDto,
} from '@/lib/nasiya-return'
import { nasiyaScheduleStatusAfterReturn } from '@/lib/nasiya-return'
import {
  exchangeRateSourceLabel,
  nasiyaResolutionEventLabel,
  nasiyaResolutionLabel,
  nasiyaStatusLabel,
  paymentMethodLabel,
} from '@/lib/presentation-labels'

type NasiyaPayment = NasiyaPaymentDisplayRecord
type ResolutionState = 'ACTIVE' | 'ARCHIVED'
type ResolutionAction = 'ARCHIVE' | 'REOPEN'
type ResolutionEventType = ResolutionAction

interface NasiyaEditPatch {
  note: string | null
  importNote: string | null
  reminderEnabled: boolean
  customer: { name: string; phone: string }
}

interface ResolutionEvent {
  id: string
  eventType: ResolutionEventType
  previousState: ResolutionState
  newState: ResolutionState
  contractCurrency: 'UZS' | 'USD'
  nativeRemaining: MoneyDto
  frozenUzs: MoneyDto
  frozenFxQuote: FxQuoteDto
  reason: string
  actorId: string
  actorType: string
  reversesEventId: string | null
  createdAt: string
}

interface Nasiya {
  id: string
  shopId: string
  contractCurrency: 'UZS' | 'USD'
  contractTerms: {
    original: MoneyDto
    downPayment: MoneyDto
    principal: MoneyDto
    interest: MoneyDto
    financed: MoneyDto
    monthly: MoneyDto
    interestPercent: number
  }
  ledger: NasiyaLedgerDto
  status: string
  resolutionState: ResolutionState
  resolutionUpdatedAt: string | null
  /** Omitted from the server DTO for staff because it contains owner-only archive amounts. */
  resolutionEvents?: ResolutionEvent[]
  resolutionHistoryTruncated?: boolean
  displayStatus?: 'ACTIVE' | 'OVERDUE' | 'COMPLETED' | 'CANCELLED' | 'RETURNED'
  returnedAt: string | null
  returnedBy: string | null
  reminderEnabled?: boolean
  note?: string | null
  importData?: {
    isImported: boolean
    source: string | null
    importedAt: string | null
    originalSaleDate: string | null
    originalTotal: MoneyDto | null
    alreadyPaid: MoneyDto
    remainingAtImport: MoneyDto | null
    note: string | null
  }
  device: { id: string; model: string; status: string }
  customer: { id: string; name: string; phone: string; hasPassportPhoto?: boolean }
  schedules: NasiyaSchedule[]
  settlementQuotes: { full: NasiyaSettlementQuote; waive: NasiyaSettlementQuote } | null
  settlement: (NasiyaSettlementRecordDto & {
    allocations?: NasiyaSettlementMutationResult['allocations']
  }) | null
  returnQuote: NasiyaReturnQuoteDto | null
  returnRecord: NasiyaReturnRecordDto | null
  payments?: NasiyaPayment[]
  paymentHistoryTruncated?: boolean
  paymentScore?: {
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
  const canOpen = [
    'NASIYA_VIEW',
    'NASIYA_CREATE',
    'NASIYA_EDIT',
    'NASIYA_PAYMENT_RECEIVE',
    'NASIYA_RETURN_REFUND',
    'NASIYA_DEFER',
    'NASIYA_REMINDER_MANAGE',
    'NASIYA_ARCHIVE',
    'NASIYA_REOPEN',
  ].some((permission) => can(permission as Parameters<typeof can>[0]))
  if (!canOpen) return <ShopAccessDenied />
  return <AuthorizedNasiyaDetailPage />
}

function AuthorizedNasiyaDetailPage() {
  const { can } = useShopAccess()
  const canBrowseNasiyas = can('NASIYA_VIEW') || can('NASIYA_EDIT') || can('NASIYA_RETURN_REFUND') || can('NASIYA_REMINDER_MANAGE') || can('NASIYA_ARCHIVE') || can('NASIYA_REOPEN')
  const canEditNasiya = can('NASIYA_EDIT')
  const canReceivePayment = can('NASIYA_PAYMENT_RECEIVE')
  const canWaiveProfit = can('NASIYA_PROFIT_WAIVE')
  const canReturnNasiya = can('NASIYA_RETURN_REFUND')
  const canDeferNasiya = can('NASIYA_DEFER')
  const canManageReminder = can('NASIYA_REMINDER_MANAGE')
  const canArchiveNasiya = can('NASIYA_ARCHIVE')
  const canReopenNasiya = can('NASIYA_REOPEN')
  const canResolveNasiya = canArchiveNasiya || canReopenNasiya
  const canViewPassportPhoto = can('CUSTOMER_PASSPORT_PHOTO_VIEW')
  const canViewLogs = can('LOG_VIEW')
  const resolutionCommand = useLogicalCommandIdempotency()
  const params = useParams()
  const id = params.id as string
  const { currency } = useShopCurrency()

  const [nasiya, setNasiya] = useState<Nasiya | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [detailDataLoaded, setDetailDataLoaded] = useState(false)
  const [detailDataLoading, setDetailDataLoading] = useState(false)

  const [passportUrl, setPassportUrl] = useState<string | null>(null)
  const [unavailablePassportCustomerId, setUnavailablePassportCustomerId] = useState<string | null>(null)
  const [passportRequested, setPassportRequested] = useState(false)
  const [reminderSubmitting, setReminderSubmitting] = useState(false)
  const [logs, setLogs] = useState<NasiyaLog[]>([])
  const [logsRequested, setLogsRequested] = useState(false)
  const [logsLoading, setLogsLoading] = useState(false)
  const [logsLoaded, setLogsLoaded] = useState(false)

  const [paymentModalOpen, setPaymentModalOpen] = useState(false)
  const [deferModalOpen, setDeferModalOpen] = useState(false)
  const [settlementModalOpen, setSettlementModalOpen] = useState(false)
  const [returnModalOpen, setReturnModalOpen] = useState(false)
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
  const [editFieldErrors, setEditFieldErrors] = useState<{ customerName?: string; customerPhone?: string }>({})

  const fetchNasiya = useCallback((view: 'summary' | 'full' = 'summary') => {
    if (!id) return
    if (view === 'full') setDetailDataLoading(true)
    fetch(`/api/nasiya/${id}?view=${view}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.success) {
          setNasiya(json.data)
          if (view === 'full') setDetailDataLoaded(true)
          else setDetailDataLoaded(false)
        } else {
          setError(json.error || 'Xatolik yuz berdi')
        }
      })
      .catch(() => setError('Xatolik yuz berdi'))
      .finally(() => {
        if (view === 'summary') setLoading(false)
        else setDetailDataLoading(false)
      })
  }, [id])

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => fetchNasiya())
    return () => window.cancelAnimationFrame(frame)
  }, [fetchNasiya])

  function patchOperationLedger(current: Nasiya, update: NasiyaPaymentMutationResult['ledger'] | NasiyaDeferMutationResult['ledger']) {
    const nextStatus = update?.status as 'ACTIVE' | 'OVERDUE' | 'COMPLETED' | undefined
    return {
      ...current,
      ledger: {
        ...current.ledger,
        ...(update?.paid ? { paid: update.paid } : {}),
        ...(update?.remaining ? { remaining: update.remaining } : {}),
        ...(nextStatus ? { status: nextStatus, isOverdue: nextStatus === 'OVERDUE' } : {}),
      },
      ...(nextStatus ? { status: nextStatus, displayStatus: nextStatus } : {}),
    }
  }

  function applyPaymentResult(receipt: NasiyaPaymentMutationResult) {
    setNasiya((current) => {
      if (!current) return current
      const allocations = new Map((receipt.allocations ?? []).map((allocation) => [allocation.scheduleId, allocation.applied]))
      const patched = patchOperationLedger(current, receipt.ledger)
      return {
        ...patched,
        schedules: patched.schedules.map((schedule) => {
          const applied = allocations.get(schedule.id)
          if (!applied) return schedule
          const remaining = subtractMoneyDto(schedule.remaining, applied)
          return {
            ...schedule,
            paid: addMoneyDto(schedule.paid, applied),
            remaining,
            status: remaining.minorUnits === 0 ? 'PAID' : schedule.status === 'PENDING' ? 'PARTIAL' : schedule.status,
          }
        }),
      }
    })
  }

  function applyDeferResult(result: NasiyaDeferMutationResult) {
    if (!result.nasiyaScheduleId || !result.newDueDate) return
    setNasiya((current) => {
      if (!current) return current
      const patched = patchOperationLedger(current, result.ledger)
      return {
        ...patched,
        schedules: patched.schedules.map((schedule) => schedule.id === result.nasiyaScheduleId
          ? { ...schedule, status: 'DEFERRED', delayedUntil: result.newDueDate! }
          : schedule),
      }
    })
  }

  function applySettlementResult(result: NasiyaSettlementMutationResult) {
    setNasiya((current) => {
      if (!current) return current
      const allocationBySchedule = new Map(result.allocations.map((allocation) => [allocation.scheduleId, allocation]))
      return {
        ...current,
        status: 'COMPLETED',
        displayStatus: 'COMPLETED',
        reminderEnabled: false,
        settlementQuotes: null,
        settlement: { ...result.settlement, allocations: result.allocations },
        ledger: {
          ...current.ledger,
          paid: result.ledger.paid,
          waived: result.ledger.waived,
          fulfilled: result.ledger.fulfilled,
          remaining: result.ledger.remaining,
          parentPaid: result.ledger.paid,
          parentWaived: result.ledger.waived,
          parentRemaining: result.ledger.remaining,
          status: 'COMPLETED',
          isOverdue: false,
          overdue: { currency: current.contractCurrency, minorUnits: 0 },
          overdueCount: 0,
          nextPaymentDate: null,
          health: 'HEALTHY',
          reasons: [],
          parentInSync: true,
          repair: null,
          schedules: current.ledger.schedules.map((schedule) => {
            const allocation = allocationBySchedule.get(schedule.id)
            return allocation
              ? {
                  ...schedule,
                  paid: addMoneyDto(schedule.paid, allocation.cash),
                  waived: addMoneyDto(schedule.waived, allocation.interestWaived),
                  remaining: allocation.remainingAfter,
                }
              : schedule
          }),
        },
        schedules: current.schedules.map((schedule) => {
          const allocation = allocationBySchedule.get(schedule.id)
          return allocation
            ? {
                ...schedule,
                paid: addMoneyDto(schedule.paid, allocation.cash),
                waived: addMoneyDto(schedule.waived ?? { currency: current.contractCurrency, minorUnits: 0 }, allocation.interestWaived),
                remaining: allocation.remainingAfter,
                status: allocation.interestWaived.minorUnits > 0 ? 'SETTLED' : 'PAID',
              }
            : schedule
        }),
      }
    })
  }

  function applyReturnResult(result: NasiyaReturnMutationResult) {
    setNasiya((current) => current ? {
      ...current,
      returnedAt: result.return.returnedAt,
      returnedBy: result.return.actorId,
      displayStatus: 'RETURNED',
      reminderEnabled: false,
      returnQuote: null,
      returnRecord: result.return,
      settlementQuotes: null,
      device: { ...current.device, status: result.deviceStatus },
      schedules: current.schedules.map((schedule) => ({
        ...schedule,
        status: nasiyaScheduleStatusAfterReturn(schedule.status),
      })),
    } : current)
  }

  // Fetch through the tenant-scoped customer endpoint only when the user
  // chooses to view the image; the private storage key never enters browser
  // state, URLs, logs, or query caches.
  const passportCustomerId = nasiya?.customer?.id ?? null
  const hasPassportPhoto = nasiya?.customer?.hasPassportPhoto ?? false
  const passportPhotoAvailable = hasPassportPhoto && unavailablePassportCustomerId !== passportCustomerId
  useEffect(() => {
    if (!passportRequested || !canViewPassportPhoto || !passportCustomerId || !hasPassportPhoto) return
    let cancelled = false
    fetch(`/api/customers/${encodeURIComponent(passportCustomerId)}/passport/image`)
      .then(async (response) => {
        const json = await response.json() as { success?: boolean; data?: { url?: string } }
        if (cancelled) return
        if (response.ok && json.success && json.data?.url) {
          setPassportUrl(json.data.url)
          return
        }
        setPassportUrl(null)
        setUnavailablePassportCustomerId(passportCustomerId)
      })
      .catch(() => {
        if (!cancelled) {
          setPassportUrl(null)
          setUnavailablePassportCustomerId(passportCustomerId)
        }
      })
    return () => {
      cancelled = true
    }
  }, [canViewPassportPhoto, hasPassportPhoto, passportCustomerId, passportRequested])

  // Audit rows are loaded only after the user opens their history section.
  const nasiyaShopId = nasiya?.shopId
  const nasiyaId = nasiya?.id
  useEffect(() => {
    if (!logsRequested || !canViewLogs || !nasiyaId) return
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
        setLogsLoaded(true)
      })
      .catch(() => {
        if (!cancelled) {
          setLogs([])
          setLogsLoaded(true)
        }
      })
      .finally(() => {
        if (!cancelled) setLogsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [canViewLogs, logsRequested, nasiya?.schedules, nasiyaId, nasiyaShopId])

  function requestLogs() {
    setLogsLoaded(false)
    setLogsLoading(true)
    setLogsRequested(true)
  }

  function openEdit() {
    setEditCustomerName(nasiya?.customer.name ?? '')
    setEditCustomerPhone(nasiya?.customer.phone ?? '')
    setEditNote(nasiya?.note ?? '')
    setEditImportNote(nasiya?.importData?.note ?? '')
    setEditReminderEnabled(nasiya?.reminderEnabled ?? true)
    setEditError('')
    setEditFieldErrors({})
    setEditOpen(true)
  }

  async function handleEditSave() {
    if (!nasiya || editSaving) return
    const customerName = editCustomerName.trim()
    const customerPhone = editCustomerPhone.trim()
    const fieldErrors = canEditNasiya ? {
      ...(customerName.length < 2 ? { customerName: "Mijoz ismi kamida 2 ta harfdan iborat bo'lishi kerak" } : {}),
      ...(!isValidPhone(customerPhone) ? { customerPhone: "Telefon raqam noto'g'ri. Masalan: +998 90 123 45 67" } : {}),
    } : {}
    if (Object.keys(fieldErrors).length > 0) {
      setEditFieldErrors(fieldErrors)
      // Keep the dialog usable with a keyboard: the first invalid editable
      // field receives focus instead of leaving the user at the save button.
      requestAnimationFrame(() => {
        document.getElementById(fieldErrors.customerName ? 'nasiya-edit-customer' : 'nasiya-edit-phone')?.focus()
      })
      return
    }
    setEditSaving(true)
    setEditError('')
    setEditFieldErrors({})
    try {
      const res = await fetch(`/api/nasiya/${nasiya.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(canEditNasiya ? {
            customerName: editCustomerName.trim(),
            customerPhone: editCustomerPhone.trim(),
            note: editNote.trim(),
            importNote: nasiya.importData?.isImported ? editImportNote.trim() : undefined,
          } : {}),
          ...(canManageReminder ? { reminderEnabled: editReminderEnabled } : {}),
        }),
      })
      const json = await res.json()
      if (res.ok && json.success) {
        const updated = json.data as NasiyaEditPatch
        setNasiya((current) => current
          ? {
              ...current,
              note: updated.note,
              importData: current.importData
                ? { ...current.importData, note: updated.importNote }
                : current.importData,
              reminderEnabled: updated.reminderEnabled,
              customer: { ...current.customer, ...updated.customer },
            }
          : current)
        void commitNavigationMutation({
          kind: 'nasiya.updated',
          nasiyaId: nasiya.id,
        })
        setEditOpen(false)
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
        setNasiya((current) => current ? {
          ...current,
          reminderEnabled: !current.reminderEnabled,
        } : current)
        void commitNavigationMutation({
          kind: 'nasiya.reminderUpdated',
          nasiyaId: nasiya.id,
        })
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
      const kind = resolutionAction === 'ARCHIVE' ? 'nasiya.archived' : 'nasiya.reopened'
      void commitNavigationMutation({ kind, nasiyaId: nasiya.id })
      setResolutionAction(null)
      fetchNasiya(detailDataLoaded ? 'full' : 'summary')
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

  // Progress is based entirely on the reconciled schedule projection, never
  // on a potentially stale parent cache or a legacy UZS snapshot.
  const { contractTerms, ledger } = nasiya
  const pct = ledger.financed.minorUnits > 0
    ? Math.min(100, Math.round((ledger.fulfilled.minorUnits / ledger.financed.minorUnits) * 100))
    : 0
  const contractMonthlyPayment = nasiya.schedules?.[0]?.expected ?? contractTerms.monthly
  const contractTotal = addMoneyDto(contractTerms.downPayment, contractTerms.financed)
  const mfmt = (amount: MoneyDto) => {
    const primary = formatMoneyDto(amount)
    const currentApproximation = amount.currency === currency.currency
      ? null
      : convertMoneyDto(amount, currency.currency, currency.fxQuote)
    return currentApproximation ? `${primary} · ≈ ${formatMoneyDto(currentApproximation)}` : primary
  }
  const currentFxCaption = nasiya.contractCurrency !== currency.currency && currency.fxQuote?.rate
    ? [
        `Joriy kurs bo'yicha ≈ · 1 USD = ${currency.fxQuote.rate} so'm`,
        exchangeRateSourceLabel(currency.fxQuote.source),
        currency.fxQuote.effectiveAt || currency.fxQuote.fetchedAt
          ? uzDate(currency.fxQuote.effectiveAt ?? currency.fxQuote.fetchedAt)
          : null,
        currency.fxQuote.freshness === 'FALLBACK' ? exchangeRateSourceLabel('FALLBACK') : null,
      ].filter(Boolean).join(' · ')
    : null


  // Server-derived (src/lib/nasiya-contract-status.ts) so this page
  // can never disagree with the nasiyalar list about completed/overdue state
  // — falls back to the raw stored status only if an older API response
  // didn't include it yet.
  const displayStatus = nasiya.displayStatus ?? (nasiya.status as 'ACTIVE' | 'OVERDUE' | 'COMPLETED' | 'CANCELLED')
  const isReturned = displayStatus === 'RETURNED' || Boolean(nasiya.returnedAt)
  const currentCustomerDebt: MoneyDto = isReturned
    ? { currency: nasiya.contractCurrency, minorUnits: 0 }
    : ledger.remaining
  const isCompleted = displayStatus === 'COMPLETED'
  const isOperationallyActive = nasiya.resolutionState === 'ACTIVE' && !isReturned
  const ledgerQuarantined = ledger.health === 'QUARANTINED'
  const resolutionEvents = nasiya.resolutionEvents ?? []
  const operationContext: NasiyaOperationContext = {
    id: nasiya.id,
    customer: { name: nasiya.customer.name },
    device: { model: nasiya.device.model },
    contractCurrency: nasiya.contractCurrency,
    ledger: {
      remaining: nasiya.ledger.remaining,
      status: nasiya.ledger.status,
      health: nasiya.ledger.health,
    },
    schedules: nasiya.schedules,
  }
  const statusBadgeStyles: Record<string, string> = {
    ACTIVE: 'bg-zinc-100 text-zinc-700',
    OVERDUE: 'bg-red-100 text-red-700',
    COMPLETED: 'bg-emerald-100 text-emerald-700',
    CANCELLED: 'bg-zinc-100 text-zinc-600',
    RETURNED: 'bg-violet-100 text-violet-800',
  }

  return (
    <div className="p-6 space-y-5 max-w-4xl">
      <Link href={canBrowseNasiyas ? '/shop/nasiyalar' : '/shop/yangi-operatsiya'} className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900">
        <ArrowLeft size={14} />
        {canBrowseNasiyas ? 'Nasiyalarga qaytish' : 'Operatsiyalarga qaytish'}
      </Link>

      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold text-zinc-900">{nasiya.customer.name}</h1>
            <span className={`inline-block px-2.5 py-1 rounded text-xs font-medium ${statusBadgeStyles[displayStatus]}`}>
              {nasiyaStatusLabel(displayStatus)}
            </span>
            {nasiya.resolutionState === 'ARCHIVED' && (
              <span className="inline-block rounded bg-blue-100 px-2.5 py-1 text-xs font-medium text-blue-800">
                Arxivlangan
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
        <div className="flex flex-wrap items-center justify-end gap-2">
          {(canEditNasiya || canManageReminder) && !isReturned && (
            <Button variant="outline" onClick={openEdit} className="h-9 px-3 text-sm border-zinc-200 text-zinc-700 hover:bg-zinc-50 rounded">
              <Pencil size={14} />
              Tahrirlash
            </Button>
          )}
          {canDeferNasiya && !ledgerQuarantined && isOperationallyActive && !isCompleted && (
            <Button variant="outline" onClick={() => setDeferModalOpen(true)} className="h-9 px-3 text-sm border-zinc-200 text-zinc-700 hover:bg-zinc-50 rounded">
              Muddatni uzaytirish
            </Button>
          )}
          {canReceivePayment && !ledgerQuarantined && isOperationallyActive && !isCompleted && (
            <Button onClick={() => setPaymentModalOpen(true)} className="h-9 px-4 text-sm bg-zinc-900 hover:bg-zinc-800 text-white rounded">
              To'lov qabul qilish
            </Button>
          )}
          {canReceivePayment && nasiya.settlementQuotes && !ledgerQuarantined && isOperationallyActive && !isCompleted && (
            <Button variant="outline" onClick={() => setSettlementModalOpen(true)} className="h-9 px-4 text-sm border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100 rounded">
              Nasiyani yopish
            </Button>
          )}
          {canReturnNasiya && nasiya.returnQuote && !isReturned && (
            <Button
              variant="destructive"
              onClick={() => setReturnModalOpen(true)}
              className="h-9 px-4 text-sm rounded"
            >
              <RotateCcw size={14} />
              Nasiyani qaytarish
            </Button>
          )}
          {canResolveNasiya && !isReturned && (
            <>
              {canArchiveNasiya && nasiya.resolutionState === 'ACTIVE' && (
                <Button variant="outline" onClick={() => openResolution('ARCHIVE')} className="h-9 px-3 text-sm border-zinc-200 rounded">
                  Arxivlash
                </Button>
              )}
              {canReopenNasiya && nasiya.resolutionState === 'ARCHIVED' && (
                <Button variant="outline" onClick={() => openResolution('REOPEN')} className="h-9 px-3 text-sm border-zinc-200 rounded">
                  Qayta ochish
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {nasiya.resolutionState === 'ARCHIVED' && !isReturned && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
          Bu nasiya ish navbatidan arxivlangan. Moliyaviy qoldiq o'zgarmagan; qayta ochilmaguncha to'lov va muddat uzaytirish yopiq.
        </div>
      )}

      {ledgerQuarantined && !isReturned && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Nasiya jadvali va hisob dalillari mos emas. To&apos;lov hamda muddatni o&apos;zgartirish tekshiruv tugaguncha yopildi.
        </div>
      )}

      {isCompleted && !isReturned && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
          <div className="text-sm font-semibold text-emerald-900">
            {nasiya.settlement?.mode === 'WAIVE_REMAINING_PROFIT'
              ? 'Bu nasiya kelgusi foyda kechilib yopilgan.'
              : nasiya.settlement
                ? 'Bu nasiya foydasi bilan yopilgan.'
                : "Bu nasiya to'liq yopilgan."}
          </div>
          {nasiya.settlement && <div className="mt-1 text-xs text-emerald-800/80">
            Olingan: {mfmt(nasiya.settlement.cashReceived)}
            {nasiya.settlement.interestWaived.minorUnits > 0 ? ` · Kechilgan foyda: ${mfmt(nasiya.settlement.interestWaived)}` : ''}
          </div>}
          <div className="text-xs text-emerald-800/80 mt-0.5">Qurilma sotilgan/nasiyadagi holatida qoladi — omborga qaytarilmaydi.</div>
        </div>
      )}

      {isReturned && (
        <div className="rounded-lg border border-violet-200 bg-violet-50 px-4 py-4">
          <div className="text-sm font-semibold text-violet-950">Bu nasiya qaytarilgan.</div>
          <p className="mt-1 text-xs text-violet-800">
            Qurilma omborga qaytdi, mijozning joriy qarzi {mfmt(currentCustomerDebt)}. Kelgusi qarz va kelgusi foyda bekor qilindi; asl shartnoma va to‘lov tarixi faqat tarix sifatida saqlandi.
          </p>
          {nasiya.returnRecord ? (
            <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div><dt className="text-xs text-violet-700">Jami olingan</dt><dd className="mt-0.5 font-semibold text-violet-950">{mfmt(nasiya.returnRecord.receipts)}</dd></div>
              <div><dt className="text-xs text-violet-700">Qaytarilgan</dt><dd className="mt-0.5 font-semibold text-violet-950">{mfmt(nasiya.returnRecord.refund)}</dd></div>
              <div><dt className="text-xs text-violet-700">Do‘konda qolgan</dt><dd className="mt-0.5 font-semibold text-violet-950">{mfmt(nasiya.returnRecord.retained)}</dd></div>
              <div><dt className="text-xs text-violet-700">Bekor qilingan qarz</dt><dd className="mt-0.5 font-semibold text-violet-950">{mfmt(nasiya.returnRecord.cancelledDebt)}</dd></div>
              <div className="col-span-2 sm:col-span-4">
                <dt className="text-xs text-violet-700">Qaytarish sababi</dt>
                <dd className="mt-0.5 whitespace-pre-wrap text-violet-950">{nasiya.returnRecord.reason}</dd>
              </div>
              <div className="col-span-2 text-xs text-violet-700 sm:col-span-4">
                {uzDate(nasiya.returnRecord.returnedAt)}
                {nasiya.returnRecord.refundMethod ? ` · ${paymentMethodLabel(nasiya.returnRecord.refundMethod)}` : ' · Pul qaytarilmagan'}
              </div>
            </dl>
          ) : (
            <p className="mt-2 text-xs text-violet-800">Eski qaytarish yozuvining batafsil ledgeri mavjud emas.</p>
          )}
        </div>
      )}

      {canBrowseNasiyas && nasiya.note && (
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3">
          <div className="text-xs font-medium text-zinc-500">Izoh</div>
          <div className="mt-1 text-sm text-zinc-800 whitespace-pre-wrap">{nasiya.note}</div>
        </div>
      )}

      {canBrowseNasiyas && nasiya.importData?.isImported && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-center gap-2">
            <span className="inline-block rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">Avvalgi nasiya</span>
            <span className="text-sm font-semibold text-amber-900">Import qilingan nasiya</span>
          </div>
          <p className="mt-1 text-xs text-amber-800/80">
            Bu Oryx’dan avvalgi nasiya. Importgacha to‘langan pul joriy oy daromadiga qo‘shilmaydi.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
            <ImportField label="Manba" value={exchangeRateSourceLabel(nasiya.importData.source)} />
            <ImportField label="Import sanasi" value={nasiya.importData.importedAt ? uzDate(nasiya.importData.importedAt) : '—'} />
            <ImportField label="Eski sotuv sanasi" value={nasiya.importData.originalSaleDate ? uzDate(nasiya.importData.originalSaleDate) : '—'} />
            <ImportField label="Avvalgi nasiya summasi" value={nasiya.importData.originalTotal ? mfmt(nasiya.importData.originalTotal) : '—'} />
            <ImportField label="Importgacha to'langan" value={mfmt(nasiya.importData.alreadyPaid)} />
            <ImportField label="Import paytidagi qarz" value={nasiya.importData.remainingAtImport ? mfmt(nasiya.importData.remainingAtImport) : '—'} />
          </div>
          {nasiya.importData.note && (
            <div className="mt-3 text-xs text-amber-800">
              <span className="font-medium">Izoh:</span> {nasiya.importData.note}
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
          // Contract currency is always primary; any second value is an
          // explicitly approximate current-rate display.
          { label: 'Shartnomadagi qurilma narxi', value: mfmt(contractTerms.original) },
          {
            label: "Boshlang'ich to'lov",
            value: mfmt(contractTerms.downPayment),
          },
          ...(contractTerms.interest.minorUnits > 0
            ? [
                {
                  label: 'Nasiya foizi',
                  value: `${contractTerms.interestPercent}%`,
                },
                {
                  label: 'Shartnoma bo\'yicha jami foiz',
                  value: mfmt(contractTerms.interest),
                },
              ]
            : []),
          { label: "Bo'lib to'lash jami (boshlang'ichsiz)", value: mfmt(ledger.financed) },
          { label: 'Jami shartnoma qiymati', value: mfmt(contractTotal) },
          { label: "To'langan", value: mfmt(ledger.paid) },
          ...(!isReturned && ledger.waived.minorUnits > 0
            ? [{ label: 'Kechilgan kelgusi foyda', value: mfmt(ledger.waived) }]
            : []),
          {
            label: "Qarz qoldig'i",
            value: mfmt(currentCustomerDebt),
          },
          { label: "Oylik to'lov", value: mfmt(contractMonthlyPayment) },
        ].map((c) => (
          <Card key={c.label} className="rounded-lg" size="sm">
            <CardContent>
              <div className="text-xs text-zinc-500 mb-1">{c.label}</div>
              <div className="text-base font-bold text-zinc-900">{c.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>
      {currentFxCaption && <p className="-mt-2 text-xs text-zinc-500">{currentFxCaption}</p>}

      {/* Progress */}
      {nasiya.paymentScore && !isReturned && (
        <>
          <Card className="rounded-lg">
            <CardHeader>
              <CardTitle>Umumiy progress</CardTitle>
              <CardDescription>
                {isCompleted ? "Nasiya to'liq yopilgan" : "Nasiya bo'yicha jami to'langan summa"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex justify-between text-sm mb-2">
                <span className="text-zinc-600 font-medium">
                  {mfmt(ledger.paid)} to'landi{ledger.waived.minorUnits > 0 ? ` · ${mfmt(ledger.waived)} kechildi` : ''}
                </span>
                <span className="font-bold text-zinc-900">{pct}%</span>
              </div>
              <Progress value={pct} className="h-2.5 rounded-full" />
              <div className="flex justify-between text-xs text-zinc-400 mt-1.5">
                <span>{mfmt({ currency: nasiya.contractCurrency, minorUnits: 0 })}</span>
                <span>{mfmt(ledger.financed)}</span>
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
                  ? 'To‘liq yopilgan nasiya bo‘yicha tarixiy to‘lov xatti-harakati'
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
                <div>
                  Vaqtida:{' '}
                  {nasiya.paymentScore.factors.earlyPaymentCount +
                    nasiya.paymentScore.factors.onTimePaymentCount}
                </div>
                <div>Kechikkan: {nasiya.paymentScore.factors.latePaymentCount}</div>
                <div>Muddati o'tgan: {nasiya.paymentScore.factors.overdueScheduleCount}</div>
                <div>
                  Ishonch:{' '}
                  {historyConfidenceLabels[nasiya.paymentScore.factors.historyConfidence] ?? "Noma'lum"}
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* Reminder toggle */}
      {(canBrowseNasiyas || canManageReminder) && !isReturned && <div className="border border-zinc-200 rounded p-4 flex items-center justify-between gap-4">
        <div>
          <div className="text-sm font-semibold text-zinc-900">To'lov eslatmasi</div>
          <div className="text-xs text-zinc-500 mt-0.5">
            {!isOperationallyActive
              ? "Arxiv holatida eslatmalar yuborilmaydi"
              : nasiya.reminderEnabled ? 'Eslatma yoqilgan' : "Eslatma o'chirilgan"}
          </div>
        </div>
        {canManageReminder && isOperationallyActive && (
          <AsyncButton
            onClick={handleToggleReminder}
            pending={reminderSubmitting}
            pendingLabel="Saqlanmoqda..."
            variant={nasiya.reminderEnabled ? 'outline' : 'default'}
            className={
              nasiya.reminderEnabled
                ? 'h-9 px-4 text-sm border-zinc-200 text-zinc-700 rounded disabled:opacity-40'
                : 'h-9 px-4 text-sm bg-zinc-900 hover:bg-zinc-800 text-white rounded disabled:opacity-40'
            }
          >
            {nasiya.reminderEnabled ? "Eslatmani o'chirish" : 'Eslatmani yoqish'}
          </AsyncButton>
        )}
      </div>}

      {canResolveNasiya && resolutionEvents.length > 0 && (
        <Card className="rounded-lg">
          <CardHeader>
            <CardTitle>Undirish holati tarixi</CardTitle>
            <CardDescription>Arxivlash va qayta ochish amallari</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {nasiya.resolutionHistoryTruncated && (
              <p role="status" className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                Eng so‘nggi 100 ta arxivlash amali ko‘rsatilmoqda; eski yozuvlar audit tarixida saqlanadi.
              </p>
            )}
            {resolutionEvents.map((event) => (
              <div key={event.id} className="rounded-lg border border-zinc-200 p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-zinc-900">
                    {nasiyaResolutionEventLabel(event.eventType)}
                  </span>
                  <span className="text-xs text-zinc-500">{uzDate(event.createdAt)}</span>
                </div>
                <div className="mt-1 text-xs text-zinc-500">
                  {nasiyaResolutionLabel(event.previousState)} → {nasiyaResolutionLabel(event.newState)} · {formatMoneyDto(event.nativeRemaining)}
                  {' · '}muzlatilgan UZS: {formatMoneyDto(event.frozenUzs)}
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
      {canViewPassportPhoto && <div className="border border-zinc-200 rounded overflow-hidden">
        <div className="px-4 py-3 bg-zinc-50 border-b border-zinc-200 font-semibold text-sm text-zinc-900">Pasport rasmi</div>
        <div className="p-4">
          {passportPhotoAvailable && !passportRequested ? (
            <button type="button" onClick={() => setPassportRequested(true)} className="rounded border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50">
              Pasport rasmini ko&apos;rish
            </button>
          ) : passportPhotoAvailable && passportUrl ? (
            <div className="relative aspect-[4/3] max-h-80 w-full overflow-hidden rounded border border-zinc-200 bg-zinc-50">
              <Image src={passportUrl} alt="Pasport rasmi" fill sizes="(max-width: 640px) 100vw, 720px" unoptimized className="object-contain" />
            </div>
          ) : passportPhotoAvailable && !passportUrl ? (
            <div className="text-sm text-zinc-400">Yuklanmoqda...</div>
          ) : (
            <div className="text-sm text-zinc-400">Pasport rasmi yuklanmagan</div>
          )}
        </div>
      </div>}

      <NasiyaHistorySections
        schedules={nasiya.schedules ?? []}
        payments={nasiya.payments ?? []}
        logs={logs}
        formatMoney={mfmt}
        historyLoaded={detailDataLoaded}
        historyLoading={detailDataLoading}
        onLoadHistory={() => fetchNasiya('full')}
        logsLoaded={!canViewLogs || logsLoaded}
        logsLoading={logsLoading}
        onLoadLogs={canViewLogs ? requestLogs : undefined}
        settlement={nasiya.settlement}
        paymentHistoryTruncated={nasiya.paymentHistoryTruncated}
      />

      {/* Payment modal — shared component, also used on the nasiyalar list */}
      {canReceivePayment && !ledgerQuarantined && isOperationallyActive && (
        <NasiyaPaymentModal
          nasiyaId={nasiya.id}
          open={paymentModalOpen}
          onOpenChange={setPaymentModalOpen}
          customerName={nasiya.customer.name}
          deviceName={nasiya.device.model}
          initialContext={operationContext}
          onSuccess={applyPaymentResult}
        />
      )}

      {canDeferNasiya && !ledgerQuarantined && isOperationallyActive && (
        <NasiyaDeferModal
          nasiyaId={nasiya.id}
          open={deferModalOpen}
          onOpenChange={setDeferModalOpen}
          customerName={nasiya.customer.name}
          deviceName={nasiya.device.model}
          initialContext={operationContext}
          onSuccess={applyDeferResult}
        />
      )}

      {canReceivePayment && nasiya.settlementQuotes && !ledgerQuarantined && isOperationallyActive && !isCompleted && (
        <NasiyaSettlementModal
          nasiyaId={nasiya.id}
          shopId={nasiya.shopId}
          open={settlementModalOpen}
          onOpenChange={setSettlementModalOpen}
          initialQuotes={nasiya.settlementQuotes}
          canWaiveProfit={canWaiveProfit}
          customerName={nasiya.customer.name}
          deviceName={nasiya.device.model}
          onQuotesRefreshed={(quotes) => setNasiya((current) => current ? { ...current, settlementQuotes: quotes } : current)}
          onSuccess={applySettlementResult}
        />
      )}

      {canReturnNasiya && nasiya.returnQuote && !isReturned && (
        <NasiyaReturnModal
          nasiyaId={nasiya.id}
          shopId={nasiya.shopId}
          deviceId={nasiya.device.id}
          open={returnModalOpen}
          onOpenChange={setReturnModalOpen}
          quote={nasiya.returnQuote}
          customerName={nasiya.customer.name}
          deviceName={nasiya.device.model}
          onQuoteStale={() => fetchNasiya('summary')}
          onSuccess={applyReturnResult}
        />
      )}

      <Dialog open={resolutionAction !== null} onOpenChange={(open) => { if (!open) setResolutionAction(null) }}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-md rounded-xl sm:w-full">
          <DialogHeader>
            <DialogTitle>
              {resolutionAction === 'ARCHIVE'
                  ? 'Nasiyani arxivlash'
                  : 'Nasiyani qayta ochish'}
            </DialogTitle>
            <DialogDescription>
              {resolutionAction === 'ARCHIVE'
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
            <AsyncButton
              variant="default"
              disabled={resolutionReason.trim().length < 5}
              pending={resolutionSubmitting}
              pendingLabel="Saqlanmoqda..."
              onClick={handleResolution}
            >
              {resolutionAction === 'ARCHIVE' ? 'Arxivlash' : 'Qayta ochish'}
            </AsyncButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit (safe fields) Dialog */}
      <Dialog open={editOpen} onOpenChange={(open) => {
        setEditOpen(open)
        if (!open) {
          setEditError('')
          setEditFieldErrors({})
        }
      }}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-lg rounded-xl sm:w-full">
          <DialogHeader>
            <DialogTitle className="text-zinc-900">Nasiya ma'lumotlarini tahrirlash</DialogTitle>
            <DialogDescription className="text-sm text-zinc-500">
              Bu oynada mijoz ma'lumotlari, ixtiyoriy izoh va eslatma sozlamasi yangilanadi. Pul summalari va to'lov jadvali bu yerda o'zgarmaydi.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[min(60vh,34rem)] space-y-5 overflow-y-auto py-1 pr-1">
            {editError && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{editError}</div>}
            <section aria-labelledby="nasiya-edit-contact-title" className="space-y-3">
              <div>
                <h3 id="nasiya-edit-contact-title" className="text-sm font-semibold text-zinc-900">Mijoz va aloqa</h3>
                <p className="mt-0.5 text-xs text-zinc-500">Mijozni tanib olish uchun kerak bo'lgan ma'lumotlar.</p>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Mijoz ismi" required error={editFieldErrors.customerName}>
                  <Input
                    disabled={!canEditNasiya}
                    id="nasiya-edit-customer"
                    value={editCustomerName}
                    onChange={(event) => setEditCustomerName(event.target.value)}
                    autoComplete="name"
                    className="h-9 rounded-lg border-zinc-200 text-sm"
                  />
                </Field>
                <Field label="Telefon" required error={editFieldErrors.customerPhone}>
                  <PhoneInput
                    disabled={!canEditNasiya}
                    id="nasiya-edit-phone"
                    value={editCustomerPhone}
                    onChange={setEditCustomerPhone}
                    className="h-9 rounded-lg border-zinc-200 text-sm"
                  />
                </Field>
              </div>
            </section>

            <section aria-labelledby="nasiya-edit-note-title" className="space-y-3 border-t border-zinc-100 pt-4">
              <div>
                <h3 id="nasiya-edit-note-title" className="text-sm font-semibold text-zinc-900">Ishchi ma'lumotlar</h3>
                <p className="mt-0.5 text-xs text-zinc-500">Izoh majburiy emas; kerak bo'lsa ichki eslatma yozing.</p>
              </div>
              <Field label="Ichki izoh" help="Ixtiyoriy">
                <Textarea
                  disabled={!canEditNasiya}
                  id="nasiya-edit-note"
                  value={editNote}
                  onChange={(event) => setEditNote(event.target.value)}
                  placeholder="Masalan: mijoz bilan kelishilgan qo'shimcha ma'lumot"
                  className="min-h-24 rounded-lg border-zinc-200 text-sm"
                />
              </Field>
              {nasiya.importData?.isImported && (
                <Field label="Import izohi" help="Ixtiyoriy">
                  <Textarea
                    disabled={!canEditNasiya}
                    id="nasiya-edit-import-note"
                    value={editImportNote}
                    onChange={(event) => setEditImportNote(event.target.value)}
                    placeholder="Import manbasi yoki eski kelishuv haqida eslatma"
                    className="min-h-20 rounded-lg border-zinc-200 text-sm"
                  />
                </Field>
              )}
              <fieldset className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                <legend className="px-1 text-xs font-medium text-zinc-700">Eslatma sozlamasi</legend>
                <label htmlFor="edit-nasiya-reminder" className="flex cursor-pointer items-start gap-2 text-sm text-zinc-700">
                  <input
                    id="edit-nasiya-reminder"
                    type="checkbox"
                    disabled={!canManageReminder}
                    checked={editReminderEnabled}
                    onChange={(event) => setEditReminderEnabled(event.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-zinc-300"
                  />
                  <span>
                    <span className="block font-medium">To'lov eslatmasi yoqilgan</span>
                    <span className="mt-0.5 block text-xs text-zinc-500">Yoqilganda, faol nasiya uchun belgilangan eslatmalar yuboriladi.</span>
                  </span>
                </label>
              </fieldset>
            </section>

            <section aria-labelledby="nasiya-edit-contract-title" className="space-y-3 border-t border-zinc-100 pt-4">
              <div>
                <h3 id="nasiya-edit-contract-title" className="text-sm font-semibold text-zinc-900">Shartnoma va moliyaviy ma'lumotlar</h3>
                <p className="mt-0.5 text-xs text-zinc-500">Faqat ko'rish uchun. To'lov tarixi saqlanishi uchun summa, foiz va jadval bu oynada tahrirlanmaydi.</p>
              </div>
              <dl className="grid grid-cols-2 gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm sm:grid-cols-3">
                {[
                  { label: 'Qurilma narxi', value: mfmt(contractTerms.original) },
                  { label: 'Jami shartnoma foizi', value: mfmt(contractTerms.interest) },
                  { label: "Bo'lib to'lash jami", value: mfmt(ledger.financed) },
                  { label: 'Jami shartnoma qiymati', value: mfmt(contractTotal) },
                  { label: "To'langan", value: mfmt(ledger.paid) },
                  { label: 'Qarz qoldig\'i', value: mfmt(ledger.remaining) },
                  { label: "Oylik to'lov", value: mfmt(contractMonthlyPayment) },
                  { label: 'Valyuta', value: nasiya.contractCurrency },
                ].map((item) => (
                  <div key={item.label} className="min-w-0">
                    <dt className="text-xs text-zinc-500">{item.label}</dt>
                    <dd className="mt-0.5 truncate font-medium text-zinc-900">{item.value}</dd>
                  </div>
                ))}
              </dl>
              <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                Moliyaviy xatoni tuzatish uchun alohida, tasdiqlangan moliyaviy tuzatish amali kerak. Bu oynada tarixni o'zgartirish mumkin emas.
              </p>
            </section>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setEditOpen(false)
                setEditError('')
                setEditFieldErrors({})
              }}
              className="rounded-lg border-zinc-200 text-zinc-700"
            >
              Bekor qilish
            </Button>
            <AsyncButton
              pending={editSaving}
              pendingLabel="Saqlanmoqda..."
              onClick={handleEditSave}
              className="rounded-lg bg-zinc-900 text-white hover:bg-zinc-800 disabled:opacity-40"
            >
              Saqlash
            </AsyncButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
