'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { DateInput } from '@/components/ui/date-input'
import { MoneyInput } from '@/components/ui/money-input'
import { Textarea } from '@/components/ui/textarea'
import { Field } from '@/components/ui/field'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  addMoneyDto,
  convertMoneyDto,
  createMoneyDto,
  currencyLabel,
  formatMoneyDto,
  moneyDtoEquals,
  moneyDtoToAmount,
  subtractMoneyDto,
  type MoneyDto,
} from '@/lib/currency'
import { uzDate, uzMonthYear } from '@/lib/dates'
import { useShopCurrency } from '@/lib/use-shop-currency'
import { tashkentTodayInputValue } from '@/lib/timezone'
import { commitNavigationMutation } from '@/lib/client-events'
import { useLogicalCommandIdempotency } from '@/lib/use-logical-command-idempotency'
import { useNasiyaOperationContext } from '@/lib/use-nasiya-operation-context'
import { useAuthenticatedQueryScope } from '@/components/query-scope-context'
import { queryKeys } from '@/lib/query-keys'
import type { NasiyaOperationContext, NasiyaOperationSchedule, NasiyaPaymentMutationResult } from '@/lib/nasiya-operation-context'
import { AsyncButton } from '@/components/ui/async-button'

/**
 * The single receive-payment modal used by BOTH the nasiya detail page and the
 * nasiyalar list. It fetches the nasiya's own schedules so it is fully
 * self-contained, and posts to the existing /api/nasiya/[id]/payment endpoint
 * (idempotency key, selected-month-first allocation, inputCurrency, carry-over)
 * — no payment logic is duplicated here.
 */

type Schedule = NasiyaOperationSchedule

type RowStatus = 'PAID' | 'PENDING' | 'PARTIAL' | 'OVERDUE' | 'DEFERRED' | 'CANCELLED'

const scheduleStatusLabels: Record<RowStatus, string> = {
  PAID: "To'landi",
  PENDING: 'Kutilmoqda',
  PARTIAL: "Qisman to'landi",
  OVERDUE: "Muddati o'tgan",
  DEFERRED: "Keyinga o'tkazilgan",
  CANCELLED: 'Bekor qilingan',
}

function rowDisplayStatus(row: Schedule): RowStatus {
  if (row.status === 'CANCELLED') return 'CANCELLED'
  if (row.remaining.minorUnits === 0) return 'PAID'
  if (row.status === 'OVERDUE') return 'OVERDUE'
  if (row.status === 'DEFERRED') return 'DEFERRED'
  return row.paid.minorUnits > 0 ? 'PARTIAL' : 'PENDING'
}

function scheduleTriggerLabel(row: Schedule) {
  return `${row.monthNumber}-oy · ${uzMonthYear(row.dueDate)}`
}

export interface NasiyaPaymentModalProps {
  nasiyaId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called after a successful payment so the caller can revalidate. */
  onSuccess: (result: NasiyaPaymentMutationResult) => void
  /** Optional context shown instantly while schedules load. */
  customerName?: string
  deviceName?: string
  /** Queue actions preselect this still-open schedule when it remains valid. */
  preferredScheduleId?: string
  /** Detail pages can immediately reuse their already-loaded schedule DTO. */
  initialContext?: NasiyaOperationContext
}

export function NasiyaPaymentModal({ nasiyaId, open, onOpenChange, onSuccess, customerName, deviceName, preferredScheduleId, initialContext }: NasiyaPaymentModalProps) {
  const paymentCommand = useLogicalCommandIdempotency()
  const { currency } = useShopCurrency()
  const queryClient = useQueryClient()
  const scope = useAuthenticatedQueryScope()
  const contextQuery = useNasiyaOperationContext({
    nasiyaId,
    intent: 'payment',
    enabled: open,
    initialData: initialContext,
  })

  const [payAmount, setPayAmount] = useState('')
  const [payMethod, setPayMethod] = useState('')
  const [payDate, setPayDate] = useState('')
  const [payNote, setPayNote] = useState('')
  // Split payment (e.g. half cash, half card). `payMethod` above doubles as
  // the FIRST part's method; `splitMethod2` is the second part's method.
  // Each part has its OWN amount input — `splitAmount1Input`/
  // `splitAmount2Input` — the total is always the SUM of the two parts,
  // never a "total minus second part" subtraction. See
  // docs/product-feature-fixes.md's split-payment amount-entry fix.
  const [splitPayment, setSplitPayment] = useState(false)
  const [splitMethod2, setSplitMethod2] = useState('')
  const [splitAmount1Input, setSplitAmount1Input] = useState('')
  const [splitAmount2Input, setSplitAmount2Input] = useState('')
  // Whether the user has directly typed into the second amount field. While
  // untouched, it auto-fills from `suggestedAmount - firstAmount` whenever
  // the first amount changes; once the user edits it directly, auto-fill
  // stops overwriting their input. The "Qolganini qo'yish" button resets
  // this back to false, so it resumes auto-following. See
  // docs/product-feature-fixes.md's split-payment remaining-amount fix.
  const [splitAmount2Touched, setSplitAmount2Touched] = useState(false)
  const [selectedScheduleId, setSelectedScheduleId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [payError, setPayError] = useState('')

  // Native contract value is always primary. A current FX conversion is a
  // secondary approximation only, never a debt calculation or stored value.
  const moneyView = (amount: MoneyDto) => {
    const primary = formatMoneyDto(amount)
    const converted = amount.currency === currency.currency
      ? null
      : convertMoneyDto(amount, currency.currency, currency.fxQuote)
    return converted ? `${primary} · ≈ ${formatMoneyDto(converted)}` : primary
  }

  // Reset user-entered fields immediately as the dialog shell opens. Query
  // loading is separate so React Query can dedupe and abort it safely.
  useEffect(() => {
    if (!open || !nasiyaId) return
    const frame = window.requestAnimationFrame(() => {
      setPayError('')
      setPayAmount('')
      setPayMethod('')
      setPayDate(tashkentTodayInputValue())
      setPayNote('')
      setSplitPayment(false)
      setSplitMethod2('')
      setSplitAmount1Input('')
      setSplitAmount2Input('')
      setSplitAmount2Touched(false)
      setSelectedScheduleId('')
    })
    return () => window.cancelAnimationFrame(frame)
  }, [open, nasiyaId])

  const schedules = useMemo(() => contextQuery.data?.schedules ?? [], [contextQuery.data?.schedules])
  // Frozen at creation, never changes with the shop's display toggle.
  const contractCurrency = contextQuery.data?.contractCurrency ?? 'UZS'
  const ledgerRemaining = contextQuery.data?.ledger.remaining ?? null
  const loadingData = open && contextQuery.isPending && !contextQuery.data
  const contextError = contextQuery.error instanceof Error ? contextQuery.error.message : ''

  useEffect(() => {
    if (!open || schedules.length === 0) return
    const frame = window.requestAnimationFrame(() => {
      const pending = schedules
        .filter((schedule) => schedule.status !== 'CANCELLED' && schedule.remaining.minorUnits > 0)
        .sort((a, b) => a.monthNumber - b.monthNumber)
      setSelectedScheduleId((current) => {
        if (current && pending.some((schedule) => schedule.id === current)) return current
        const preferred = preferredScheduleId ? pending.find((schedule) => schedule.id === preferredScheduleId) : undefined
        return preferred?.id ?? pending[0]?.id ?? ''
      })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [open, preferredScheduleId, schedules])

  const pendingSchedules = schedules
    .filter((s) => s.status !== 'CANCELLED' && s.remaining?.minorUnits > 0)
    .sort((a, b) => a.monthNumber - b.monthNumber)
  const selectedSchedule = pendingSchedules.find((s) => s.id === selectedScheduleId)
  const selectedScheduleRemaining = selectedSchedule?.remaining ?? null

  // The "suggested"/"target" amount — the selected schedule's own
  // outstanding balance, converted into whatever currency the user is
  // typing in. Shared by BOTH the single-mode and split-mode "Tavsiya
  // etilgan summa" buttons and by split mode's auto-fill-the-remainder
  // calculation, so they can never disagree on what "the recommended
  // amount" means. `null` when there's nothing to recommend (no schedule
  // outstanding balance, or a USD contract with no rate to convert with).
  const suggestedMoney = selectedScheduleRemaining
    ? convertMoneyDto(selectedScheduleRemaining, currency.currency, currency.fxQuote)
    : null

  // Formatting is a DTO boundary as well: the browser never calculates with
  // raw Decimal strings or adds/subtracts floating currency values.
  const formatAmountForInput = (money: MoneyDto) => {
    const amount = moneyDtoToAmount(money)
    return money.currency === 'USD' ? amount.toFixed(2) : String(amount)
  }
  const parseDisplayMoney = (value: string): MoneyDto | null => {
    try {
      return createMoneyDto(currency.currency, value.trim() || '0')
    } catch {
      return null
    }
  }

  // Split payment: each part has its OWN amount; the total the customer is
  // paying is the SUM of the parts — never a total-minus-second-part
  // subtraction. `splitValid` requires both parts present, both positive,
  // and distinct methods (a "split" between the same method twice is
  // rejected — that's just one payment, not a split).
  const splitPart1Money = parseDisplayMoney(splitAmount1Input)
  const splitPart2Money = parseDisplayMoney(splitAmount2Input)
  const splitMoney = splitPart1Money && splitPart2Money
    ? addMoneyDto(splitPart1Money, splitPart2Money)
    : null
  const splitValid =
    !splitPayment ||
    (Boolean(payMethod) &&
      Boolean(splitMethod2) &&
      splitAmount1Input.trim().length > 0 &&
      Boolean(splitPart1Money && splitPart1Money.minorUnits > 0) &&
      splitAmount2Input.trim().length > 0 &&
      Boolean(splitPart2Money && splitPart2Money.minorUnits > 0) &&
      splitMethod2 !== payMethod)

  // The amount actually being submitted: the split total when split mode is
  // on, otherwise the single "Miqdor" field. Every downstream currency/
  // validation calculation below reads from this ONE number so single and
  // split mode always agree on what "the amount" means.
  const singleMoney = payAmount.trim().length > 0 ? parseDisplayMoney(payAmount) : null
  const enteredMoney = splitPayment ? splitMoney : singleMoney
  const hasEffectiveAmount = Boolean(enteredMoney && enteredMoney.minorUnits > 0)
  // The only client guard is the reconciled TOTAL schedule debt. It does not
  // trust the legacy parent remainingAmount cache.
  const payAmountContract = enteredMoney
    ? convertMoneyDto(enteredMoney, contractCurrency, currency.fxQuote)
    : null
  const requiresCrossCurrencyRate = Boolean(enteredMoney && enteredMoney.currency !== contractCurrency && !payAmountContract)
  const exceedsRemaining = Boolean(
    payAmountContract && ledgerRemaining && payAmountContract.minorUnits > ledgerRemaining.minorUnits,
  )
  const overpayExtraContract = payAmountContract && selectedScheduleRemaining && payAmountContract.minorUnits > selectedScheduleRemaining.minorUnits
    ? subtractMoneyDto(payAmountContract, selectedScheduleRemaining)
    : null
  const splitComparison = splitMoney && suggestedMoney && !moneyDtoEquals(splitMoney, suggestedMoney)
    ? splitMoney.minorUnits < suggestedMoney.minorUnits
      ? { kind: 'REMAINING' as const, amount: subtractMoneyDto(suggestedMoney, splitMoney) }
      : { kind: 'EXTRA' as const, amount: subtractMoneyDto(splitMoney, suggestedMoney) }
    : null

  const suggestedRemainderAfterFirstPart = (firstPart: string): MoneyDto | null => {
    if (!suggestedMoney) return null
    const firstMoney = parseDisplayMoney(firstPart)
    if (!firstMoney || firstMoney.minorUnits >= suggestedMoney.minorUnits) return null
    return subtractMoneyDto(suggestedMoney, firstMoney)
  }

  const canSubmit = Boolean(
    enteredMoney && enteredMoney.minorUnits > 0 && payMethod && payDate.trim() && selectedScheduleId && !requiresCrossCurrencyRate && !exceedsRemaining && splitValid,
  )

  async function handleSubmit() {
    if (!canSubmit || submitting) return
    if (requiresCrossCurrencyRate) {
      setPayError("Faqat turli valyutadagi to'lov uchun USD kursi kerak. Kurs tiklangach qayta urinib ko'ring.")
      return
    }
    setSubmitting(true)
    setPayError('')
    try {
      const payload = {
        nasiyaScheduleId: selectedScheduleId,
        // Split mode: the submitted total is always the SUM of the two
        // parts (never a total-minus-second-part subtraction).
        amount: moneyDtoToAmount(enteredMoney!),
        inputCurrency: currency.currency,
        paymentMethod: payMethod,
        paymentBreakdown:
          splitPayment
            ? [
                { method: payMethod, amount: moneyDtoToAmount(splitPart1Money!) },
                { method: splitMethod2, amount: moneyDtoToAmount(splitPart2Money!) },
              ]
            : undefined,
        date: payDate,
        note: payNote || undefined,
      }
      const res = await fetch(`/api/nasiya/${nasiyaId}/payment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': paymentCommand.keyFor(payload),
        },
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (res.ok && json.success) {
        paymentCommand.committed()
        const receipt = json.data as NasiyaPaymentMutationResult
        for (const intent of ['payment', 'defer'] as const) {
          queryClient.setQueryData<NasiyaOperationContext>(
            queryKeys.nasiyas.operationContext(scope, nasiyaId, intent),
            (current) => {
              if (!current) return current
              const allocations = new Map((receipt.allocations ?? []).map((allocation) => [allocation.scheduleId, allocation.applied]))
              return {
                ...current,
                ledger: {
                  ...current.ledger,
                  ...(receipt.ledger?.remaining ? { remaining: receipt.ledger.remaining } : {}),
                  ...(receipt.ledger?.status ? { status: receipt.ledger.status } : {}),
                },
                schedules: current.schedules.map((schedule) => {
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
            },
          )
        }
        void commitNavigationMutation({
          kind: 'nasiya.paymentRecorded',
          nasiyaId,
        }).catch(() => undefined)
        onOpenChange(false)
        onSuccess(receipt)
      } else {
        paymentCommand.rejected(res.status)
        setPayError(json.error || "To'lovda xatolik")
      }
    } catch {
      setPayError("To'lovda xatolik")
    } finally {
      setSubmitting(false)
    }
  }

  const subtitleCustomer = contextQuery.data?.customer.name || customerName || ''
  const subtitleDevice = contextQuery.data?.device.model || deviceName || ''

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      if (!nextOpen && submitting) return
      onOpenChange(nextOpen)
    }}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-xl gap-0 overflow-hidden rounded-xl p-0 sm:w-full">
        <DialogHeader className="border-b border-zinc-100 px-5 py-4">
          <DialogTitle className="text-base font-semibold text-zinc-900">To&apos;lov qabul qilish</DialogTitle>
          <DialogDescription className="text-sm text-zinc-500">
            {[subtitleCustomer, subtitleDevice].filter(Boolean).join(' · ') || 'Nasiya to’lovi'}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[65vh] space-y-4 overflow-y-auto px-5 py-4">
          {(payError || contextError) && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{payError || contextError}</div>}

          {loadingData ? (
            <div
              className="space-y-3 py-2"
              role="status"
              aria-live="polite"
              aria-label="To‘lov jadvali yuklanmoqda"
            >
              <span className="sr-only">To‘lov jadvali yuklanmoqda</span>
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="animate-pulse rounded-lg border border-zinc-200 p-3">
                  <div className="h-4 w-32 rounded bg-zinc-200" />
                  <div className="mt-2 h-3 w-48 max-w-full rounded bg-zinc-100" />
                </div>
              ))}
            </div>
          ) : (
            <>
              {pendingSchedules.length > 0 && (
                <div className="space-y-2">
                  <label htmlFor="nasiya-schedule" className="block text-xs font-medium text-zinc-700">
                    Qaysi oy to&apos;lovi? <span aria-hidden="true" className="text-red-500">*</span>
                  </label>
                  <Select value={selectedScheduleId} onValueChange={(v) => v && setSelectedScheduleId(v)}>
                    <SelectTrigger id="nasiya-schedule" aria-required="true" className="h-11 w-full rounded-lg border-zinc-200 text-sm [&>span]:truncate">
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
                              {uzDate(s.dueDate)} · qolgan {moneyView(s.remaining)}
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
                      <span className="text-sm font-semibold text-zinc-900">{selectedScheduleRemaining ? moneyView(selectedScheduleRemaining) : '—'}</span>
                    </div>
                  )}
                </div>
              )}

              <label htmlFor="nasiya-split-payment" className="flex items-center gap-2 text-xs font-medium text-zinc-700">
                  <input
                    id="nasiya-split-payment"
                    type="checkbox"
                    checked={splitPayment}
                    onChange={(e) => {
                      // Toggling split mode (either direction) always starts
                      // from a clean slate — never carries a stale amount
                      // over from before the toggle.
                      setSplitPayment(e.target.checked)
                      setSplitMethod2('')
                      setSplitAmount1Input('')
                      setSplitAmount2Input('')
                      setSplitAmount2Touched(false)
                    }}
                    className="h-4 w-4 rounded border-zinc-300"
                  />
                  Aralash to&apos;lov (masalan: yarmi naqd, yarmi karta)
              </label>

              {!splitPayment && (
                <div className="space-y-2">
                  <label htmlFor="nasiya-payment-amount" className="block text-xs font-medium text-zinc-700">
                    Miqdor ({currencyLabel(currency.currency)}) <span aria-hidden="true" className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <MoneyInput
                      id="nasiya-payment-amount"
                      required
                      currency={currency.currency}
                      value={payAmount}
                      onChange={setPayAmount}
                      placeholder={
                        suggestedMoney
                          ? formatAmountForInput(suggestedMoney)
                          : currency.currency === 'USD'
                            ? '100.00'
                            : '1000000'
                      }
                      className="h-12 rounded-lg border-zinc-200 pr-14 text-lg font-semibold"
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-zinc-400">
                      {currencyLabel(currency.currency)}
                    </span>
                  </div>
                  {selectedScheduleRemaining && suggestedMoney && (
                    <button
                      type="button"
                      onClick={() => {
                        setPayAmount(formatAmountForInput(suggestedMoney))
                      }}
                      className="inline-flex items-center gap-1 rounded-md border border-zinc-300 bg-zinc-100 px-2.5 py-1 text-xs font-semibold text-zinc-800 hover:border-zinc-400 hover:bg-zinc-200"
                    >
                      Tavsiya etilgan summa: {moneyView(selectedScheduleRemaining)}
                    </button>
                  )}
                </div>
              )}

              {/* Split payment: each method has its OWN "To'lov usuli N" block
                  with its own method select + amount input — never a single
                  total field re-purposed as "first part". The total below is
                  ALWAYS the sum of the two parts and is never itself editable. */}
              {splitPayment && (
                <div className="space-y-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                  <fieldset className="space-y-1.5">
                    <legend className="block text-xs font-medium text-zinc-700">
                      To&apos;lov usuli 1 <span aria-hidden="true" className="text-red-500">*</span>
                    </legend>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <label htmlFor="nasiya-split-method-1" className="sr-only">Birinchi to&apos;lov usuli</label>
                      <Select value={payMethod} onValueChange={(v) => v && setPayMethod(v)}>
                        <SelectTrigger id="nasiya-split-method-1" aria-required="true" className="h-10 w-full rounded-lg border-zinc-200 text-sm">
                          <SelectValue placeholder="Usulni tanlang" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="CASH">Naqd</SelectItem>
                          <SelectItem value="CARD">Karta</SelectItem>
                          <SelectItem value="TRANSFER">Bank o&apos;tkazmasi</SelectItem>
                          <SelectItem value="OTHER">Boshqa</SelectItem>
                        </SelectContent>
                      </Select>
                      <label htmlFor="nasiya-split-amount-1" className="sr-only">Birinchi to&apos;lov miqdori</label>
                      <MoneyInput
                        id="nasiya-split-amount-1"
                        required
                        currency={currency.currency}
                        value={splitAmount1Input}
                        onChange={(v) => {
                          setSplitAmount1Input(v)
                          // Auto-fill the second amount from the remaining
                          // suggested amount — but only while the user hasn't
                          // directly edited it themselves.
                          if (!splitAmount2Touched) {
                            const remaining = suggestedRemainderAfterFirstPart(v)
                            setSplitAmount2Input(remaining ? formatAmountForInput(remaining) : '')
                          }
                        }}
                        placeholder={currency.currency === 'USD' ? '60.00' : '600000'}
                        className="h-10 rounded-lg border-zinc-200 text-sm"
                      />
                    </div>
                    {selectedScheduleRemaining && suggestedMoney && (
                      <button
                        type="button"
                        onClick={() => {
                          // Option A: fill part 1 with the exact recommended
                          // input-currency amount; leave part 2 empty.
                          setSplitAmount2Touched(false)
                          setSplitAmount1Input(formatAmountForInput(suggestedMoney))
                          setSplitAmount2Input('')
                        }}
                        className="inline-flex items-center gap-1 rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-xs font-semibold text-zinc-800 hover:border-zinc-400 hover:bg-zinc-100"
                      >
                        Tavsiya etilgan summa: {moneyView(selectedScheduleRemaining)}
                      </button>
                    )}
                  </fieldset>

                  <fieldset className="space-y-1.5">
                    <legend className="block text-xs font-medium text-zinc-700">
                      To&apos;lov usuli 2 <span aria-hidden="true" className="text-red-500">*</span>
                    </legend>
                    {suggestedMoney && (
                      <button
                        type="button"
                        onClick={() => {
                          const remaining = suggestedRemainderAfterFirstPart(splitAmount1Input)
                          setSplitAmount2Input(remaining ? formatAmountForInput(remaining) : '')
                          // Resuming auto-follow — the button IS the
                          // auto-fill action, so further edits to part 1
                          // should keep updating part 2 again until the
                          // user types into it directly.
                          setSplitAmount2Touched(false)
                        }}
                        className="block text-xs font-medium text-zinc-600 underline hover:text-zinc-900"
                      >
                        Qolganini qo&apos;yish
                      </button>
                    )}
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <label htmlFor="nasiya-split-method-2" className="sr-only">Ikkinchi to&apos;lov usuli</label>
                      <Select value={splitMethod2} onValueChange={(v) => v && setSplitMethod2(v)}>
                        <SelectTrigger id="nasiya-split-method-2" aria-required="true" className="h-10 w-full rounded-lg border-zinc-200 text-sm">
                          <SelectValue placeholder="Usulni tanlang" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="CASH">Naqd</SelectItem>
                          <SelectItem value="CARD">Karta</SelectItem>
                          <SelectItem value="TRANSFER">Bank o&apos;tkazmasi</SelectItem>
                          <SelectItem value="OTHER">Boshqa</SelectItem>
                        </SelectContent>
                      </Select>
                      <label htmlFor="nasiya-split-amount-2" className="sr-only">Ikkinchi to&apos;lov miqdori</label>
                      <MoneyInput
                        id="nasiya-split-amount-2"
                        required
                        currency={currency.currency}
                        value={splitAmount2Input}
                        onChange={(v) => {
                          setSplitAmount2Touched(true)
                          setSplitAmount2Input(v)
                        }}
                        placeholder={currency.currency === 'USD' ? '40.00' : '400000'}
                        className="h-10 rounded-lg border-zinc-200 text-sm"
                      />
                    </div>
                  </fieldset>

                  {splitMethod2 && payMethod && splitMethod2 === payMethod && (
                    <p className="text-xs text-red-600">Ikkala usul bir xil bo&apos;lmasligi kerak.</p>
                  )}

                  <div className="flex items-center justify-between border-t border-zinc-200 pt-2.5 text-sm">
                    <span className="font-medium text-zinc-700">Jami to&apos;lov</span>
                    <span className="font-semibold text-zinc-900">{splitMoney ? formatMoneyDto(splitMoney) : '—'}</span>
                  </div>

                  {/* Real-time comparison against the suggested/target amount
                      — independent of the "Jami qolgan qarz"/overpay block
                      below, which compares against the WHOLE remaining
                      contract debt. Hidden when the split total already
                      matches the suggested amount (within currency dust
                      tolerance) — "normal state", nothing to flag. */}
                  {splitComparison &&
                    (splitComparison.kind === 'REMAINING' ? (
                      <p className="text-xs text-zinc-600">
                        Qolgan: {formatMoneyDto(splitComparison.amount)}
                      </p>
                    ) : (
                      <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5">
                        Ortiqcha: {formatMoneyDto(splitComparison.amount)}
                      </p>
                    ))}
                </div>
              )}

              {hasEffectiveAmount && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-zinc-500">
                    <span>Jami qolgan qarz</span>
                    <span className="font-medium text-zinc-700">{ledgerRemaining ? moneyView(ledgerRemaining) : '—'}</span>
                  </div>
                  {payAmountContract && enteredMoney?.currency !== contractCurrency && (
                    <p className="text-xs text-zinc-500">Shartnomaga qo&apos;llanadi: {moneyView(payAmountContract)}</p>
                  )}
                  {requiresCrossCurrencyRate ? (
                    <p className="text-xs text-red-600">Turli valyutadagi to&apos;lov uchun joriy USD kursi mavjud emas.</p>
                  ) : exceedsRemaining ? (
                    <p className="text-xs text-red-600">To&apos;lov summasi qolgan qarzdan oshmasligi kerak.</p>
                  ) : overpayExtraContract ? (
                    <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                      To&apos;lov joriy oydan oshdi. Ortiqcha {moneyView(overpayExtraContract)} keyingi oy to&apos;loviga qo&apos;llanadi.
                    </p>
                  ) : null}
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {!splitPayment && (
                  <div className="space-y-2">
                    <label htmlFor="nasiya-payment-method" className="block text-xs font-medium text-zinc-700">
                      To&apos;lov usuli <span aria-hidden="true" className="text-red-500">*</span>
                    </label>
                    <Select value={payMethod} onValueChange={(v) => v && setPayMethod(v)}>
                      <SelectTrigger id="nasiya-payment-method" aria-required="true" className="h-11 w-full rounded-lg border-zinc-200 text-sm">
                        <SelectValue placeholder="Usulni tanlang" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="CASH">Naqd</SelectItem>
                        <SelectItem value="CARD">Karta</SelectItem>
                        <SelectItem value="TRANSFER">Bank o&apos;tkazmasi</SelectItem>
                        <SelectItem value="OTHER">Boshqa</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <Field
                  label="To'lov sanasi"
                  required
                  className={splitPayment ? 'sm:col-span-2' : undefined}
                >
                  <DateInput
                    value={payDate}
                    onValueChange={setPayDate}
                    className="h-11 rounded-lg border-zinc-200 text-sm"
                  />
                </Field>
              </div>

              <Field label="Izoh">
                <Textarea
                  value={payNote}
                  onChange={(e) => setPayNote(e.target.value)}
                  placeholder="Masalan: mijoz oylik to'lovni naqd berdi"
                  className="min-h-[80px] rounded-lg border-zinc-200 text-sm"
                />
              </Field>
            </>
          )}
        </div>

        <DialogFooter className="gap-2 border-t border-zinc-100 px-5 py-4">
          <Button
            variant="outline"
            disabled={submitting}
            onClick={() => {
              onOpenChange(false)
              setPayError('')
            }}
            className="rounded-lg border-zinc-200 text-zinc-700"
          >
            Bekor qilish
          </Button>
          <AsyncButton
            pending={submitting}
            pendingLabel="To'lov saqlanmoqda..."
            disabled={!canSubmit || loadingData}
            onClick={handleSubmit}
            className="rounded-lg bg-zinc-900 text-white hover:bg-zinc-800 disabled:opacity-40"
          >
            To&apos;lovni saqlash
          </AsyncButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
