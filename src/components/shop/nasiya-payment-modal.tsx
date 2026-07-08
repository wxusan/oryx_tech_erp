'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MoneyInput } from '@/components/ui/money-input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
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
import { scheduleDisplayStatus } from '@/lib/nasiya-utils'
import { convertUsdToUzs, convertUzsToUsd, currencyLabel, type CurrencyCode } from '@/lib/currency'
import { convertPaymentToContractCurrency, contractScheduleOutstanding, formatContractMoney, formatDisplayMoneyFromContract } from '@/lib/nasiya-contract'
import { uzDate, uzMonthYear } from '@/lib/dates'
import { useShopCurrency } from '@/lib/use-shop-currency'
import { tashkentTodayInputValue } from '@/lib/timezone'

/**
 * The single receive-payment modal used by BOTH the nasiya detail page and the
 * nasiyalar list. It fetches the nasiya's own schedules so it is fully
 * self-contained, and posts to the existing /api/nasiya/[id]/payment endpoint
 * (idempotency key, selected-month-first allocation, inputCurrency, carry-over)
 * — no payment logic is duplicated here.
 */

interface Schedule {
  id: string
  monthNumber: number
  dueDate: string
  delayedUntil: string | null
  expectedAmount: number
  paidAmount: number
  status: 'PENDING' | 'PARTIAL' | 'PAID' | 'OVERDUE' | 'DEFERRED'
  contractExpectedAmount: number
  contractPaidAmount: number
}

type RowStatus = 'PAID' | 'PENDING' | 'PARTIAL' | 'OVERDUE' | 'DEFERRED'

const scheduleStatusLabels: Record<RowStatus, string> = {
  PAID: "To'landi",
  PENDING: 'Kutilmoqda',
  PARTIAL: "Qisman to'landi",
  OVERDUE: "Muddati o'tgan",
  DEFERRED: "Keyinga o'tkazilgan",
}

function scheduleBalance(row: Schedule) {
  return Math.max(0, Number(row.expectedAmount) - Number(row.paidAmount))
}

/** Contract-currency outstanding balance — used only for DISPLAY (see dfmt below); validation still uses the UZS legacy figures above, which stay accurate via the dual-ledger lockstep. */
function contractScheduleBalance(row: Schedule, currency: CurrencyCode) {
  return contractScheduleOutstanding(Number(row.contractExpectedAmount), Number(row.contractPaidAmount), currency)
}

function rowDisplayStatus(row: Schedule): RowStatus {
  return scheduleDisplayStatus(row) as RowStatus
}

function scheduleTriggerLabel(row: Schedule) {
  return `${row.monthNumber}-oy · ${uzMonthYear(row.dueDate)}`
}

export interface NasiyaPaymentModalProps {
  nasiyaId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called after a successful payment/defer so the caller can revalidate. */
  onSuccess: () => void
  /** Optional context shown instantly while schedules load. */
  customerName?: string
  deviceName?: string
}

export function NasiyaPaymentModal({
  nasiyaId,
  open,
  onOpenChange,
  onSuccess,
  customerName,
  deviceName,
}: NasiyaPaymentModalProps) {
  const { currency } = useShopCurrency()

  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [loadingData, setLoadingData] = useState(false)
  const [fetched, setFetched] = useState<{ customerName: string; deviceName: string } | null>(null)
  const [nasiyaRemainingAmount, setNasiyaRemainingAmount] = useState(0)
  // Frozen at creation, never changes with the shop's display toggle — see
  // docs/currency-accounting-model.md.
  const [contractCurrency, setContractCurrency] = useState<CurrencyCode>('UZS')
  const [nasiyaContractRemainingAmount, setNasiyaContractRemainingAmount] = useState(0)

  const [payAmount, setPayAmount] = useState('')
  const [payMethod, setPayMethod] = useState('')
  const [payDate, setPayDate] = useState('')
  const [carryOver, setCarryOver] = useState(false)
  const [payNote, setPayNote] = useState('')
  const [selectedScheduleId, setSelectedScheduleId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [payError, setPayError] = useState('')

  // Schedule/remaining-debt DISPLAY must convert from the deal's own contract
  // currency using today's rate — never reconvert the frozen-creation-rate
  // legacy UZS snapshot, which would drift from the true contract value as
  // the rate moves. See docs/currency-accounting-model.md.
  const dfmt = (n: number) => formatDisplayMoneyFromContract(n, contractCurrency, currency.currency, currency.usdUzsRate)

  // Load the nasiya's schedules whenever the modal opens. All setState lives
  // inside `load` (not the effect body) to keep it off the sync-in-effect path.
  useEffect(() => {
    if (!open || !nasiyaId) return
    let cancelled = false
    const load = async () => {
      setLoadingData(true)
      setPayError('')
      setPayAmount('')
      setPayMethod('')
      setPayDate(tashkentTodayInputValue())
      setCarryOver(false)
      setPayNote('')
      try {
        const r = await fetch(`/api/nasiya/${nasiyaId}`)
        const json = await r.json()
        if (cancelled) return
        if (!json.success) {
          setPayError(json.error || 'Nasiya topilmadi')
          return
        }
        const rows: Schedule[] = json.data.schedules ?? []
        setSchedules(rows)
        setNasiyaRemainingAmount(Number(json.data.remainingAmount ?? 0))
        setContractCurrency((json.data.contractCurrency as CurrencyCode) ?? 'UZS')
        setNasiyaContractRemainingAmount(Number(json.data.contractRemainingAmount ?? 0))
        setFetched({
          customerName: json.data.customer?.name ?? '',
          deviceName: json.data.device?.model ?? '',
        })
        const firstPending = rows
          .filter((s) => ['PENDING', 'PARTIAL', 'OVERDUE', 'DEFERRED'].includes(s.status))
          .sort((a, b) => a.monthNumber - b.monthNumber)[0]
        setSelectedScheduleId(firstPending ? firstPending.id : '')
      } catch {
        if (!cancelled) setPayError('Xatolik yuz berdi')
      } finally {
        if (!cancelled) setLoadingData(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [open, nasiyaId])

  const pendingSchedules = schedules
    .filter((s) => ['PENDING', 'PARTIAL', 'OVERDUE', 'DEFERRED'].includes(s.status))
    .sort((a, b) => a.monthNumber - b.monthNumber)
  const selectedSchedule = pendingSchedules.find((s) => s.id === selectedScheduleId)
  const selectedScheduleOutstanding = selectedSchedule ? scheduleBalance(selectedSchedule) : 0
  // Native contract-currency outstanding balance — DISPLAY only (see dfmt).
  const selectedScheduleContractOutstanding = selectedSchedule ? contractScheduleBalance(selectedSchedule, contractCurrency) : 0

  // Convert the typed amount to UZS (the allocation/validation source of truth)
  // so the overpayment explanation and the "exceeds remaining debt" guard work
  // the same regardless of the shop's selected display currency.
  const payAmountUzs =
    !carryOver && payAmount.trim()
      ? currency.currency === 'USD' && currency.usdUzsRate
        ? convertUsdToUzs(Number(payAmount), currency.usdUzsRate)
        : Number(payAmount)
      : 0
  const exceedsRemaining = !carryOver && payAmountUzs > nasiyaRemainingAmount

  // Purely informational preview of what would be applied to THIS deal's own
  // (frozen) contract currency, shown only when it differs from what's being
  // typed — a best-effort client-side estimate using today's rate; the
  // server always recomputes and stores the authoritative figure at submit
  // time. Omitted when no rate is available client-side (e.g. a UZS-display
  // shop paying toward a USD contract, since the shop's own rate is only
  // fetched when its display currency is USD). See
  // docs/currency-accounting-model.md.
  const contractPreviewAmount =
    !carryOver && payAmount.trim() && contractCurrency !== currency.currency && currency.usdUzsRate
      ? convertPaymentToContractCurrency(Number(payAmount) || 0, currency.currency, contractCurrency, currency.usdUzsRate)
      : null

  // Contract-currency view of the same typed amount, used for the overpay
  // explanation below — same-currency case needs no rate at all.
  const payAmountContract =
    !carryOver && payAmount.trim()
      ? contractCurrency === currency.currency
        ? Number(payAmount) || 0
        : (contractPreviewAmount ?? 0)
      : 0
  const overpayExtraContract = Math.max(0, payAmountContract - selectedScheduleContractOutstanding)

  // "Izoh" is optional for a regular payment — only the carry-over/defer flow
  // ("Mijoz bu oy to'lamadi, muddatni uzaytirish") still requires a reason,
  // since that's a debt-schedule change, not a routine payment note.
  const canSubmit = carryOver
    ? Boolean(payDate.trim() && selectedScheduleId && payNote.trim().length >= 5)
    : Boolean(payAmount.trim() && payMethod && payDate.trim() && selectedScheduleId && !exceedsRemaining)

  async function handleSubmit() {
    if (!canSubmit || submitting) return
    if (!carryOver && currency.currency === 'USD' && !currency.usdUzsRate) {
      setPayError("USD kursi mavjud emas. UZS rejimida kiriting yoki keyinroq urinib ko'ring.")
      return
    }
    setSubmitting(true)
    setPayError('')
    try {
      const idempotencyKey = crypto.randomUUID()
      const res = await fetch(`/api/nasiya/${nasiyaId}/payment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({
          nasiyaScheduleId: selectedScheduleId,
          amount: carryOver ? 0 : Number(payAmount),
          inputCurrency: currency.currency,
          paymentMethod: carryOver ? undefined : payMethod,
          date: new Date(payDate).toISOString(),
          delayedUntil: carryOver ? new Date(payDate).toISOString() : undefined,
          deferredToNext: carryOver,
          note: payNote || undefined,
        }),
      })
      const json = await res.json()
      if (json.success) {
        onOpenChange(false)
        onSuccess()
      } else {
        setPayError(json.error || "To'lovda xatolik")
      }
    } catch {
      setPayError("To'lovda xatolik")
    } finally {
      setSubmitting(false)
    }
  }

  const subtitleCustomer = fetched?.customerName || customerName || ''
  const subtitleDevice = fetched?.deviceName || deviceName || ''

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-xl gap-0 overflow-hidden rounded-xl p-0 sm:w-full">
        <DialogHeader className="border-b border-zinc-100 px-5 py-4">
          <DialogTitle className="text-base font-semibold text-zinc-900">To&apos;lov qabul qilish</DialogTitle>
          <DialogDescription className="text-sm text-zinc-500">
            {[subtitleCustomer, subtitleDevice].filter(Boolean).join(' · ') || 'Nasiya to’lovi'}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[65vh] space-y-4 overflow-y-auto px-5 py-4">
          {payError && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
              {payError}
            </div>
          )}

          {loadingData ? (
            <div className="py-6 text-center text-sm text-zinc-400">Yuklanmoqda...</div>
          ) : (
            <>
              {pendingSchedules.length > 0 && (
                <div className="space-y-2">
                  <label className="block text-xs font-medium text-zinc-700">
                    Qaysi oy to&apos;lovi? <span className="text-red-500">*</span>
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
                              {uzDate(s.dueDate)} · qolgan {dfmt(contractScheduleBalance(s, contractCurrency))}
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
                      <span className="text-sm font-semibold text-zinc-900">{dfmt(selectedScheduleContractOutstanding)}</span>
                    </div>
                  )}
                </div>
              )}

              <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-zinc-200 px-3 py-2.5 hover:bg-zinc-50">
                <input
                  type="checkbox"
                  checked={carryOver}
                  onChange={(e) => setCarryOver(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-zinc-300"
                />
                <span className="text-sm text-zinc-700">
                  Mijoz bu oy to&apos;lamadi, muddatni uzaytirish
                  <span className="mt-0.5 block text-xs text-zinc-400">
                    Belgilansa, to&apos;lov emas — tanlangan oy keyingi sanaga suriladi.
                  </span>
                </span>
              </label>

              {!carryOver && (
                <div className="space-y-2">
                  <label className="block text-xs font-medium text-zinc-700">
                    Miqdor ({currencyLabel(currency.currency)}) <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <MoneyInput
                      currency={currency.currency}
                      value={payAmount}
                      onChange={setPayAmount}
                      placeholder={
                        selectedScheduleOutstanding
                          ? currency.currency === 'USD' && currency.usdUzsRate
                            ? convertUzsToUsd(selectedScheduleOutstanding, currency.usdUzsRate).toFixed(2)
                            : String(selectedScheduleOutstanding)
                          : currency.currency === 'USD' ? '100.00' : '1000000'
                      }
                      className="h-12 rounded-lg border-zinc-200 pr-14 text-lg font-semibold"
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-zinc-400">
                      {currencyLabel(currency.currency)}
                    </span>
                  </div>
                  {selectedScheduleOutstanding > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        // Suggest an amount that, once submitted, actually pays off
                        // this schedule exactly — computed from the deal's own
                        // contract-currency balance, not the legacy UZS snapshot.
                        // Falls back to the legacy suggestion if no rate is
                        // available client-side to convert across currencies.
                        if (contractCurrency !== currency.currency && !currency.usdUzsRate) {
                          setPayAmount(String(selectedScheduleOutstanding))
                          return
                        }
                        const suggestion = convertPaymentToContractCurrency(
                          selectedScheduleContractOutstanding,
                          contractCurrency,
                          currency.currency,
                          currency.usdUzsRate,
                        )
                        setPayAmount(currency.currency === 'USD' ? suggestion.toFixed(2) : String(Math.round(suggestion)))
                      }}
                      className="text-xs font-medium text-zinc-500 underline-offset-2 hover:text-zinc-900 hover:underline"
                    >
                      Tavsiya: {dfmt(selectedScheduleContractOutstanding)}
                    </button>
                  )}
                  <div className="flex items-center justify-between text-xs text-zinc-500">
                    <span>Jami qolgan qarz</span>
                    <span className="font-medium text-zinc-700">{dfmt(nasiyaContractRemainingAmount)}</span>
                  </div>
                  {contractPreviewAmount != null && (
                    <p className="text-xs text-zinc-500">
                      Shartnomaga qo&apos;llanadi: {formatContractMoney(contractPreviewAmount, contractCurrency)}
                      {currency.usdUzsRate ? ` · kurs: ${Math.round(currency.usdUzsRate).toLocaleString('ru-RU')}` : ''}
                    </p>
                  )}
                  {exceedsRemaining ? (
                    <p className="text-xs text-red-600">
                      To&apos;lov summasi qolgan qarzdan oshmasligi kerak.
                    </p>
                  ) : overpayExtraContract > 0 ? (
                    <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                      To&apos;lov joriy oydan oshdi. Ortiqcha {dfmt(overpayExtraContract)} keyingi oy to&apos;loviga
                      qo&apos;llanadi.
                    </p>
                  ) : null}
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {!carryOver && (
                  <div className="space-y-2">
                    <label className="block text-xs font-medium text-zinc-700">
                      To&apos;lov usuli <span className="text-red-500">*</span>
                    </label>
                    <Select value={payMethod} onValueChange={(v) => v && setPayMethod(v)}>
                      <SelectTrigger className="h-11 w-full rounded-lg border-zinc-200 text-sm">
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
                  Izoh {carryOver && <span className="text-red-500">*</span>}
                </label>
                <Textarea
                  value={payNote}
                  onChange={(e) => setPayNote(e.target.value)}
                  placeholder={carryOver ? "Masalan: mijoz 10 kunga kechiktirishni so'radi" : "Masalan: mijoz oylik to'lovni naqd berdi"}
                  className="min-h-[80px] rounded-lg border-zinc-200 text-sm"
                />
              </div>
            </>
          )}
        </div>

        <DialogFooter className="gap-2 border-t border-zinc-100 px-5 py-4">
          <Button
            variant="outline"
            onClick={() => { onOpenChange(false); setPayError('') }}
            className="rounded-lg border-zinc-200 text-zinc-700"
          >
            Bekor qilish
          </Button>
          <Button
            disabled={!canSubmit || submitting || loadingData}
            onClick={handleSubmit}
            className="rounded-lg bg-zinc-900 text-white hover:bg-zinc-800 disabled:opacity-40"
          >
            {submitting ? 'Saqlanmoqda...' : carryOver ? 'Muddatni uzaytirish' : "To'lovni saqlash"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
