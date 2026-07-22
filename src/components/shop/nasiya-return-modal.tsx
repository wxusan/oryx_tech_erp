'use client'

import { useEffect, useState } from 'react'
import { AsyncButton } from '@/components/ui/async-button'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { MoneyInput } from '@/components/ui/money-input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  createMoneyDto,
  formatMoneyDto,
  moneyDtoToAmount,
  subtractMoneyDto,
  type MoneyDto,
} from '@/lib/currency'
import type { PaymentMethod } from '@/lib/domain-types'
import type { NasiyaReturnMutationResult, NasiyaReturnQuoteDto } from '@/lib/nasiya-return'
import { paymentMethodLabel } from '@/lib/presentation-labels'
import { useLogicalCommandIdempotency } from '@/lib/use-logical-command-idempotency'
import { commitNavigationMutation } from '@/lib/client-events'

function inputValue(money: MoneyDto) {
  const amount = moneyDtoToAmount(money)
  return money.currency === 'USD' ? amount.toFixed(2) : String(amount)
}

export function NasiyaReturnModal({
  nasiyaId,
  shopId,
  deviceId,
  customerName,
  deviceName,
  quote,
  open,
  onOpenChange,
  onSuccess,
  onQuoteStale,
}: {
  nasiyaId: string
  shopId: string
  deviceId: string
  customerName: string
  deviceName: string
  quote: NasiyaReturnQuoteDto
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: (result: NasiyaReturnMutationResult) => void
  onQuoteStale?: () => void
}) {
  const command = useLogicalCommandIdempotency()
  const [refundAmount, setRefundAmount] = useState('')
  const [refundMethod, setRefundMethod] = useState<PaymentMethod | null>(null)
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    const frame = window.requestAnimationFrame(() => {
      setRefundAmount(inputValue(quote.defaultRefund))
      setRefundMethod(
        quote.defaultRefundMethod
          ?? quote.methodCapacities.find(({ available }) => available.minorUnits > 0)?.method
          ?? null,
      )
      setReason('')
      setError('')
    })
    return () => window.cancelAnimationFrame(frame)
  }, [open, quote])

  const parsedRefund = (() => {
    if (!refundAmount.trim()) return null
    try {
      return createMoneyDto(quote.contractCurrency, refundAmount)
    } catch {
      return null
    }
  })()
  const refundWithinReceipts = Boolean(parsedRefund && parsedRefund.minorUnits <= quote.maxRefund.minorUnits)
  const selectedCapacity = quote.methodCapacities.find(({ method }) => method === refundMethod)?.available ?? null
  const methodCanCoverRefund = Boolean(
    parsedRefund && (
      parsedRefund.minorUnits === 0 ||
      (refundMethod && selectedCapacity && parsedRefund.minorUnits <= selectedCapacity.minorUnits)
    ),
  )
  const retained = parsedRefund && refundWithinReceipts
    ? subtractMoneyDto(quote.receipts, parsedRefund)
    : null
  const canSubmit = quote.eligible &&
    refundWithinReceipts &&
    methodCanCoverRefund &&
    reason.trim().length >= 5

  async function submit() {
    if (!canSubmit || !parsedRefund || pending) return
    const payload = {
      shopId,
      note: reason.trim(),
      refundAmount: moneyDtoToAmount(parsedRefund),
      refundMethod: parsedRefund.minorUnits > 0 ? refundMethod ?? undefined : undefined,
      inputCurrency: quote.contractCurrency,
      expectedReceiptsMinorUnits: quote.receipts.minorUnits,
      expectedRemainingMinorUnits: quote.cancelledDebt.minorUnits,
    }
    setPending(true)
    setError('')
    try {
      const response = await fetch(`/api/nasiya/${encodeURIComponent(nasiyaId)}/return`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': command.keyFor(payload),
        },
        body: JSON.stringify(payload),
      })
      const json = await response.json() as {
        success?: boolean
        data?: NasiyaReturnMutationResult
        error?: string
      }
      if (!response.ok || !json.success || !json.data) {
        command.rejected(response.status)
        setError(json.error || 'Nasiya qaytarilmadi')
        if (response.status === 409) onQuoteStale?.()
        return
      }
      command.committed()
      void commitNavigationMutation({
        kind: 'return.created',
        nasiyaId,
        deviceId,
      }).catch(() => undefined)
      onSuccess(json.data)
      onOpenChange(false)
    } catch {
      setError("Nasiya qaytarilmadi. Internet aloqasini tekshirib, qayta urinib ko‘ring.")
    } finally {
      setPending(false)
    }
  }

  const amountError = parsedRefund && parsedRefund.minorUnits > quote.maxRefund.minorUnits
    ? `Ko‘pi bilan ${formatMoneyDto(quote.maxRefund)} qaytarish mumkin.`
    : refundAmount.trim() && !parsedRefund
      ? 'Summa noto‘g‘ri kiritilgan.'
      : parsedRefund && parsedRefund.minorUnits > 0 && !methodCanCoverRefund
        ? `Tanlangan usul bo‘yicha ko‘pi bilan ${selectedCapacity ? formatMoneyDto(selectedCapacity) : formatMoneyDto(createMoneyDto(quote.contractCurrency, 0))} qaytarish mumkin.`
        : null

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-xl gap-0 overflow-hidden rounded-xl p-0 sm:w-full">
        <DialogHeader className="border-b border-zinc-100 px-5 py-4">
          <DialogTitle>Nasiyani qaytarish</DialogTitle>
          <DialogDescription>{customerName} · {deviceName}</DialogDescription>
        </DialogHeader>

        <div className="max-h-[68vh] space-y-4 overflow-y-auto px-5 py-4" aria-busy={pending}>
          {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
          {!quote.eligible && (
            <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {quote.ineligibilityReason ?? "Bu nasiyani hozir qaytarib bo‘lmaydi."}
            </div>
          )}

          <dl className="grid grid-cols-2 gap-3 rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm">
            <div>
              <dt className="text-xs text-zinc-500">Mijozdan jami olingan summa</dt>
              <dd className="mt-1 font-semibold text-zinc-900">{formatMoneyDto(quote.receipts)}</dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500">Bekor qilinadigan qolgan qarz</dt>
              <dd className="mt-1 font-semibold text-zinc-900">{formatMoneyDto(quote.cancelledDebt)}</dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500">Mijozga qaytariladigan summa</dt>
              <dd className="mt-1 font-semibold text-red-700">{parsedRefund ? formatMoneyDto(parsedRefund) : '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500">Do‘konda qoladigan summa</dt>
              <dd className="mt-1 font-semibold text-emerald-700">{retained ? formatMoneyDto(retained) : '—'}</dd>
            </div>
          </dl>

          <label htmlFor="nasiya-return-refund" className="block text-xs font-medium text-zinc-700">
            Mijozga qaytariladigan summa
            <MoneyInput
              id="nasiya-return-refund"
              currency={quote.contractCurrency}
              value={refundAmount}
              onChange={(value) => { setRefundAmount(value); setError('') }}
              aria-invalid={Boolean(amountError)}
              aria-describedby={amountError ? 'nasiya-return-refund-error' : 'nasiya-return-refund-help'}
              disabled={!quote.eligible}
              className="mt-1.5 h-10"
            />
          </label>
          {amountError ? (
            <p id="nasiya-return-refund-error" role="alert" className="text-xs text-red-600">{amountError}</p>
          ) : (
            <p id="nasiya-return-refund-help" className="text-xs text-zinc-500">
              Boshlang‘ich qiymat — asl boshlang‘ich to‘lov. Uni 0 dan {formatMoneyDto(quote.maxRefund)} gacha o‘zgartirish mumkin.
            </p>
          )}

          {parsedRefund && parsedRefund.minorUnits > 0 ? (
            <label htmlFor="nasiya-return-method" className="block text-xs font-medium text-zinc-700">
              Qaytarish usuli
              <Select
                value={refundMethod ?? undefined}
                onValueChange={(value) => { if (value) setRefundMethod(value as PaymentMethod); setError('') }}
                disabled={!quote.eligible}
              >
                <SelectTrigger id="nasiya-return-method" className="mt-1.5 h-10">
                  <SelectValue placeholder="Usulni tanlang" />
                </SelectTrigger>
                <SelectContent>
                  {quote.methodCapacities.map(({ method, available }) => (
                    <SelectItem key={method} value={method} disabled={available.minorUnits === 0}>
                      {paymentMethodLabel(method)} · {formatMoneyDto(available)} gacha
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          ) : (
            <div className="rounded-lg border border-zinc-200 px-3 py-2 text-sm text-zinc-600">
              Qaytarish usuli: pul qaytarilmaydi
            </div>
          )}

          <label htmlFor="nasiya-return-reason" className="block text-xs font-medium text-zinc-700">
            Qaytarish sababi <span className="text-red-500">*</span>
            <Textarea
              id="nasiya-return-reason"
              value={reason}
              onChange={(event) => { setReason(event.target.value); setError('') }}
              placeholder="Masalan: mijoz bilan kelishilgan qaytarish sababi"
              aria-required="true"
              disabled={!quote.eligible}
              className="mt-1.5 min-h-24"
            />
          </label>

          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900">
            Tasdiqlanganda qurilma omborga qaytadi, to‘lanmagan qarz va kelgusi foyda bekor bo‘ladi. Asl shartnoma va barcha to‘lovlar audit tarixida o‘zgarmasdan qoladi.
          </p>
        </div>

        <DialogFooter className="border-t border-zinc-100 px-5 py-4">
          <Button variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>Bekor qilish</Button>
          <AsyncButton
            variant="destructive"
            pending={pending}
            pendingLabel="Qaytarilmoqda…"
            disabled={!canSubmit}
            onClick={submit}
          >
            Qaytarishni tasdiqlash
          </AsyncButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
