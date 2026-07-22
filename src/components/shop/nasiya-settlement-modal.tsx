'use client'

import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AsyncButton } from '@/components/ui/async-button'
import { Button } from '@/components/ui/button'
import { DateInput } from '@/components/ui/date-input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { MoneyInput } from '@/components/ui/money-input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  addMoneyDto,
  convertMoneyDto,
  createMoneyDto,
  formatMoneyDto,
  moneyDtoToAmount,
  subtractMoneyDto,
  type MoneyDto,
} from '@/lib/currency'
import type { PaymentMethod } from '@/lib/domain-types'
import {
  type NasiyaSettlementMode,
  type NasiyaSettlementMutationResult,
  type NasiyaSettlementQuote,
} from '@/lib/nasiya-settlement'
import { paymentMethodLabel } from '@/lib/presentation-labels'
import { tashkentTodayInputValue } from '@/lib/timezone'
import { useShopCurrency } from '@/lib/use-shop-currency'
import { useLogicalCommandIdempotency } from '@/lib/use-logical-command-idempotency'
import { commitNavigationMutation } from '@/lib/client-events'
import { useAuthenticatedQueryScope } from '@/components/query-scope-context'
import { queryKeys } from '@/lib/query-keys'
import type { NasiyaOperationContext } from '@/lib/nasiya-operation-context'

type SettlementQuotes = { full: NasiyaSettlementQuote; waive: NasiyaSettlementQuote }

const METHODS: PaymentMethod[] = ['CASH', 'CARD', 'TRANSFER', 'OTHER']

function inputValue(money: MoneyDto) {
  const value = moneyDtoToAmount(money)
  return money.currency === 'USD' ? value.toFixed(2) : String(value)
}

export function NasiyaSettlementModal({
  nasiyaId,
  shopId,
  open,
  onOpenChange,
  initialQuotes,
  canWaiveProfit,
  customerName,
  deviceName,
  onSuccess,
  onQuotesRefreshed,
}: {
  nasiyaId: string
  shopId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  initialQuotes: SettlementQuotes
  canWaiveProfit: boolean
  customerName: string
  deviceName: string
  onSuccess: (result: NasiyaSettlementMutationResult) => void
  onQuotesRefreshed?: (quotes: SettlementQuotes) => void
}) {
  const command = useLogicalCommandIdempotency()
  const queryClient = useQueryClient()
  const scope = useAuthenticatedQueryScope()
  const { currency } = useShopCurrency()
  const [quotes, setQuotes] = useState(initialQuotes)
  const [mode, setMode] = useState<NasiyaSettlementMode>('FULL_WITH_PROFIT')
  const [method, setMethod] = useState<PaymentMethod>('CASH')
  const [split, setSplit] = useState(false)
  const [secondMethod, setSecondMethod] = useState<PaymentMethod>('CARD')
  const [firstPart, setFirstPart] = useState('')
  const [settledAt, setSettledAt] = useState('')
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    const frame = window.requestAnimationFrame(() => {
      setQuotes(initialQuotes)
      setMode('FULL_WITH_PROFIT')
      setMethod('CASH')
      setSecondMethod('CARD')
      setSplit(false)
      setFirstPart('')
      setSettledAt(tashkentTodayInputValue())
      setReason('')
      setError('')
    })
    return () => window.cancelAnimationFrame(frame)
  }, [initialQuotes, open])

  const quote = mode === 'FULL_WITH_PROFIT' ? quotes.full : quotes.waive
  const displayCash = convertMoneyDto(quote.cashToReceive, currency.currency, currency.fxQuote)
  const displayWaiver = convertMoneyDto(quote.interestToWaive, currency.currency, currency.fxQuote)
  const needsRate = quote.cashToReceive.currency !== currency.currency && !displayCash
  const cashRequired = quote.cashToReceive.minorUnits > 0

  const firstMoney = (() => {
    if (!firstPart.trim()) return null
    try {
      return createMoneyDto(currency.currency, firstPart)
    } catch {
      return null
    }
  })()
  const secondMoney = displayCash && firstMoney && firstMoney.minorUnits > 0 && firstMoney.minorUnits < displayCash.minorUnits
    ? subtractMoneyDto(displayCash, firstMoney)
    : null
  const splitValid = !split || Boolean(firstMoney && secondMoney && method !== secondMethod)
  const waiveAllowed = canWaiveProfit && quotes.waive.waiverEligible
  const canSubmit = Boolean(
    settledAt &&
    !needsRate &&
    splitValid &&
    (!cashRequired || method) &&
    (mode !== 'WAIVE_REMAINING_PROFIT' || (waiveAllowed && reason.trim().length >= 3)),
  )

  const moneyView = (money: MoneyDto, converted: MoneyDto | null) => converted && converted.currency !== money.currency
    ? `${formatMoneyDto(money)} · ≈ ${formatMoneyDto(converted)}`
    : formatMoneyDto(money)

  async function refreshQuotes() {
    setRefreshing(true)
    try {
      const response = await fetch(`/api/nasiya/${encodeURIComponent(nasiyaId)}/settlement?shopId=${encodeURIComponent(shopId)}`)
      const json = await response.json() as { success?: boolean; data?: { quotes?: SettlementQuotes }; error?: string }
      if (response.ok && json.success && json.data?.quotes) {
        setQuotes(json.data.quotes)
        onQuotesRefreshed?.(json.data.quotes)
        setFirstPart('')
        setError("Qolgan summa yangilandi. Yangi hisobni ko'rib, yana tasdiqlang.")
      }
    } catch {
      // Keep the original server error below; a refresh is only a recovery aid.
    } finally {
      setRefreshing(false)
    }
  }

  async function submit() {
    if (!canSubmit || pending) return
    setPending(true)
    setError('')
    const paymentBreakdown = split && firstMoney && secondMoney
      ? [
          { method, amount: moneyDtoToAmount(firstMoney) },
          { method: secondMethod, amount: moneyDtoToAmount(secondMoney) },
        ]
      : undefined
    const payload = {
      shopId,
      mode,
      paymentMethod: cashRequired ? method : undefined,
      paymentBreakdown,
      date: settledAt,
      reason: reason.trim() || undefined,
      inputCurrency: currency.currency,
      expectedContractCurrency: quote.contractCurrency,
      expectedRemainingMinorUnits: quote.remainingBefore.minorUnits,
      expectedCashMinorUnits: quote.cashToReceive.minorUnits,
      expectedWaivedMinorUnits: quote.interestToWaive.minorUnits,
    }
    try {
      const response = await fetch(`/api/nasiya/${encodeURIComponent(nasiyaId)}/settlement`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': command.keyFor(payload),
        },
        body: JSON.stringify(payload),
      })
      const json = await response.json() as { success?: boolean; data?: NasiyaSettlementMutationResult; error?: string }
      if (!response.ok || !json.success || !json.data) {
        command.rejected(response.status)
        setError(json.error || 'Nasiya yopilmadi')
        if (response.status === 409) await refreshQuotes()
        return
      }

      command.committed()
      const result = json.data
      const allocations = new Map(result.allocations.map((allocation) => [allocation.scheduleId, allocation]))
      for (const intent of ['payment', 'defer'] as const) {
        queryClient.setQueryData<NasiyaOperationContext>(
          queryKeys.nasiyas.operationContext(scope, nasiyaId, intent),
          (current) => current
            ? {
                ...current,
                ledger: {
                  ...current.ledger,
                  paid: result.ledger.paid,
                  waived: result.ledger.waived,
                  remaining: result.ledger.remaining,
                  status: 'COMPLETED',
                },
                schedules: current.schedules.map((schedule) => {
                  const allocation = allocations.get(schedule.id)
                  if (!allocation) return schedule
                  return {
                    ...schedule,
                    paid: addMoneyDto(schedule.paid, allocation.cash),
                    waived: addMoneyDto(schedule.waived ?? createMoneyDto(schedule.paid.currency, 0), allocation.interestWaived),
                    remaining: allocation.remainingAfter,
                    status: allocation.interestWaived.minorUnits > 0 ? 'SETTLED' : 'PAID',
                  }
                }),
              }
            : current,
        )
      }
      void commitNavigationMutation({ kind: 'nasiya.settled', nasiyaId }).catch(() => undefined)
      onSuccess(result)
      onOpenChange(false)
    } catch {
      setError('Nasiya yopilmadi. Internet aloqasini tekshirib, qayta urinib ko‘ring.')
    } finally {
      setPending(false)
    }
  }

  const waiveDisabledReason = !canWaiveProfit
    ? "Bu variant uchun «Nasiya foydasidan kechish» ruxsati kerak."
    : quotes.waive.waiverIneligibilityReasons[0]

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-xl gap-0 overflow-hidden rounded-xl p-0 sm:w-full">
        <DialogHeader className="border-b border-zinc-100 px-5 py-4">
          <DialogTitle>Nasiyani yopish</DialogTitle>
          <DialogDescription>{customerName} · {deviceName}</DialogDescription>
        </DialogHeader>

        <div className="max-h-[68vh] space-y-4 overflow-y-auto px-5 py-4" aria-busy={pending || refreshing}>
          {error && <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{error}</div>}

          <div role="radiogroup" aria-label="Nasiya yopish turi" className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              role="radio"
              aria-checked={mode === 'FULL_WITH_PROFIT'}
              onClick={() => { setMode('FULL_WITH_PROFIT'); setSplit(false); setFirstPart(''); setError('') }}
              className={`rounded-xl border p-4 text-left transition ${mode === 'FULL_WITH_PROFIT' ? 'border-zinc-900 bg-zinc-50 ring-1 ring-zinc-900' : 'border-zinc-200 hover:border-zinc-300'}`}
            >
              <span className="block text-sm font-semibold text-zinc-900">Foydasi bilan yopish</span>
              <span className="mt-1 block text-xs text-zinc-500">Qolgan qarz va foyda to‘liq olinadi.</span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={mode === 'WAIVE_REMAINING_PROFIT'}
              aria-disabled={!waiveAllowed}
              disabled={!waiveAllowed}
              onClick={() => { setMode('WAIVE_REMAINING_PROFIT'); setSplit(false); setFirstPart(''); setError('') }}
              className={`rounded-xl border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${mode === 'WAIVE_REMAINING_PROFIT' ? 'border-emerald-700 bg-emerald-50 ring-1 ring-emerald-700' : 'border-zinc-200 hover:border-zinc-300'}`}
            >
              <span className="block text-sm font-semibold text-zinc-900">Foydani kechib yopish</span>
              <span className="mt-1 block text-xs text-zinc-500">Qolgan qarz olinadi, kelgusi nasiya foydasi kechiladi.</span>
            </button>
          </div>
          {!waiveAllowed && waiveDisabledReason && <p className="text-xs text-zinc-500">{waiveDisabledReason}</p>}

          <dl className="grid grid-cols-2 gap-3 rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm">
            <div><dt className="text-xs text-zinc-500">Hozirgi qarz</dt><dd className="mt-1 font-semibold text-zinc-900">{moneyView(quote.remainingBefore, convertMoneyDto(quote.remainingBefore, currency.currency, currency.fxQuote))}</dd></div>
            <div><dt className="text-xs text-zinc-500">Olinadigan summa</dt><dd className="mt-1 font-semibold text-zinc-900">{moneyView(quote.cashToReceive, displayCash)}</dd></div>
            <div><dt className="text-xs text-zinc-500">Kechiladigan foyda</dt><dd className="mt-1 font-semibold text-zinc-900">{moneyView(quote.interestToWaive, displayWaiver)}</dd></div>
            <div><dt className="text-xs text-zinc-500">Yopilgandan keyin</dt><dd className="mt-1 font-semibold text-emerald-700">{formatMoneyDto(quote.remainingAfter)}</dd></div>
          </dl>

          {needsRate && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">Joriy USD kursi mavjud emas. Turli valyutadagi summa bilan yopib bo‘lmaydi.</div>}

          {cashRequired && <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <label htmlFor="nasiya-settlement-method" className="block text-xs font-medium text-zinc-700">To‘lov usuli<Select value={method} onValueChange={(value) => value && setMethod(value as PaymentMethod)}><SelectTrigger id="nasiya-settlement-method" className="mt-1.5"><SelectValue /></SelectTrigger><SelectContent>{METHODS.map((item) => <SelectItem key={item} value={item}>{paymentMethodLabel(item)}</SelectItem>)}</SelectContent></Select></label>
              <label htmlFor="nasiya-settlement-date" className="block text-xs font-medium text-zinc-700">Yopish sanasi<DateInput id="nasiya-settlement-date" value={settledAt} onValueChange={setSettledAt} className="mt-1.5" /></label>
            </div>
            <label htmlFor="nasiya-settlement-split" className="flex items-center gap-2 text-sm text-zinc-700"><input id="nasiya-settlement-split" type="checkbox" checked={split} onChange={(event) => { setSplit(event.target.checked); setFirstPart('') }} />Ikki usulda qabul qilish</label>
            {split && displayCash && <div className="grid gap-3 rounded-lg border border-zinc-200 p-3 sm:grid-cols-2">
              <label htmlFor="nasiya-settlement-first-part" className="text-xs font-medium text-zinc-700">Birinchi usul summasi<MoneyInput id="nasiya-settlement-first-part" currency={currency.currency} value={firstPart} onChange={setFirstPart} placeholder={inputValue(displayCash)} className="mt-1.5" /></label>
              <div className="space-y-2"><Select value={secondMethod} onValueChange={(value) => value && setSecondMethod(value as PaymentMethod)}><SelectTrigger aria-label="Ikkinchi to‘lov usuli"><SelectValue /></SelectTrigger><SelectContent>{METHODS.filter((item) => item !== method).map((item) => <SelectItem key={item} value={item}>{paymentMethodLabel(item)}</SelectItem>)}</SelectContent></Select><div className="rounded-md bg-zinc-50 px-3 py-2 text-sm"><span className="text-zinc-500">Ikkinchi usul:</span> <strong>{secondMoney ? formatMoneyDto(secondMoney) : '—'}</strong></div></div>
            </div>}
          </div>}

          {!cashRequired && <label htmlFor="nasiya-settlement-date" className="block text-xs font-medium text-zinc-700">Yopish sanasi<DateInput id="nasiya-settlement-date" value={settledAt} onValueChange={setSettledAt} className="mt-1.5" /></label>}

          <label htmlFor="nasiya-settlement-reason" className="block text-xs font-medium text-zinc-700">
            {mode === 'WAIVE_REMAINING_PROFIT' ? <>Sabab <span className="text-red-500">*</span></> : <>Ichki izoh <span className="text-zinc-400">(ixtiyoriy)</span></>}
            <Textarea id="nasiya-settlement-reason" aria-required={mode === 'WAIVE_REMAINING_PROFIT'} value={reason} onChange={(event) => setReason(event.target.value)} placeholder={mode === 'WAIVE_REMAINING_PROFIT' ? 'Masalan: mijoz bilan muddatidan oldin yopish kelishuvi' : 'Ichki izoh'} className="mt-1.5 min-h-20" />
          </label>

          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">Bu amal qarzni 0 ga tushiradi va ortga qaytarilmaydigan audit yozuvini yaratadi. Oldingi to‘lovlar o‘zgarmaydi.</p>
        </div>

        <DialogFooter className="border-t border-zinc-100 px-5 py-4">
          <Button variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>Bekor qilish</Button>
          <AsyncButton pending={pending} pendingLabel="Nasiya yopilmoqda…" disabled={!canSubmit || refreshing} onClick={submit}>Nasiyani yopish</AsyncButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
