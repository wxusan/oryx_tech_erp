'use client'

import { useEffect, useState } from 'react'
import { AsyncButton } from '@/components/ui/async-button'
import { Button } from '@/components/ui/button'
import { DateInput } from '@/components/ui/date-input'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { MoneyInput } from '@/components/ui/money-input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { commitNavigationMutation } from '@/lib/client-events'
import { formatMoneyDto, type MoneyDto } from '@/lib/currency'
import type { PaymentMethod } from '@/lib/domain-types'
import { paymentMethodLabel } from '@/lib/presentation-labels'
import { tashkentTodayInputValue } from '@/lib/timezone'

export interface SupplierPayablePaymentTarget {
  id: string
  deviceId: string
  remainingAmount: MoneyDto
}

export function SupplierPayablePaymentDialog({
  target,
  open,
  onOpenChange,
  onPaid,
}: {
  target: SupplierPayablePaymentTarget | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onPaid?: () => void | Promise<void>
}) {
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<PaymentMethod>('CASH')
  const [paidAt, setPaidAt] = useState('')
  const [note, setNote] = useState('')
  const [split, setSplit] = useState(false)
  const [secondMethod, setSecondMethod] = useState<PaymentMethod>('CARD')
  const [firstPart, setFirstPart] = useState('')
  const [secondPart, setSecondPart] = useState('')
  const [idempotencyKey, setIdempotencyKey] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const targetId = target?.id
  const targetCurrency = target?.remainingAmount.currency
  const targetMinorUnits = target?.remainingAmount.minorUnits

  useEffect(() => {
    if (!open || !targetId || !targetCurrency || targetMinorUnits === undefined) return
    const divisor = targetCurrency === 'USD' ? 100 : 1
    const frame = window.requestAnimationFrame(() => {
      setAmount(String(targetMinorUnits / divisor))
      setMethod('CASH')
      setPaidAt(tashkentTodayInputValue())
      setNote('')
      setSplit(false)
      setSecondMethod('CARD')
      setFirstPart('')
      setSecondPart('')
      setIdempotencyKey(crypto.randomUUID())
      setError('')
    })
    return () => window.cancelAnimationFrame(frame)
  }, [open, targetCurrency, targetId, targetMinorUnits])

  async function submit() {
    if (!target || pending) return
    const numericAmount = Number(amount)
    if (!(numericAmount > 0)) return setError("To'lov summasi musbat bo'lishi kerak")
    const tolerance = target.remainingAmount.currency === 'UZS' ? 0.5 : 0.005
    if (split && (
      method === secondMethod || Number(firstPart) <= 0 || Number(secondPart) <= 0 ||
      Math.abs(Number(firstPart) + Number(secondPart) - numericAmount) > tolerance
    )) return setError("Ikki xil usul summasi umumiy to'lovga teng bo'lishi kerak")

    setPending(true)
    setError('')
    try {
      const response = await fetch(`/api/supplier-payables/${target.id}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({
          amount: numericAmount,
          inputCurrency: target.remainingAmount.currency,
          paymentMethod: method,
          paymentBreakdown: split ? [
            { method, amount: Number(firstPart) },
            { method: secondMethod, amount: Number(secondPart) },
          ] : undefined,
          paidAt: paidAt || undefined,
          note: note.trim() || undefined,
        }),
      })
      const json = await response.json() as {
        success?: boolean
        error?: string
        data?: { payable?: { contractCurrency?: 'UZS' | 'USD'; contractRemainingAmount?: number } }
      }
      if (!response.ok || !json.success) {
        const fresh = json.data?.payable
        const freshText = response.status === 409 && fresh?.contractCurrency && fresh.contractRemainingAmount !== undefined
          ? ` Yangi qoldiq: ${fresh.contractRemainingAmount.toLocaleString('uz-UZ')} ${fresh.contractCurrency}.`
          : ''
        throw new Error(`${json.error || "To'lov saqlanmadi"}${freshText}`)
      }
      await commitNavigationMutation({ kind: 'olibSotdim.paymentRecorded', deviceId: target.deviceId })
      await onPaid?.()
      onOpenChange(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "To'lov saqlanmadi")
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Yetkazib beruvchi qarzini to‘lash</DialogTitle></DialogHeader>
        {target && <div className="space-y-4">
          <div className="rounded-lg bg-zinc-50 p-3 text-sm"><span className="text-zinc-500">Tasdiqlangan qoldiq:</span> <strong>{formatMoneyDto(target.remainingAmount)}</strong></div>
          {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => setAmount(String(target.remainingAmount.minorUnits / (target.remainingAmount.currency === 'USD' ? 100 : 1)))}>To‘liq to‘lash</Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setAmount('')}>Qisman to‘lash</Button>
          </div>
          <label htmlFor="supplier-payable-payment-amount" className="block text-xs font-medium text-zinc-700">To‘lov summasi<MoneyInput id="supplier-payable-payment-amount" currency={target.remainingAmount.currency} value={amount} onChange={setAmount} className="mt-1.5" /></label>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label htmlFor="supplier-payable-payment-method" className="mb-1.5 block text-xs font-medium text-zinc-700">To‘lov usuli</label><Select value={method} onValueChange={(value) => value && setMethod(value as PaymentMethod)}><SelectTrigger id="supplier-payable-payment-method"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="CASH">Naqd pul</SelectItem><SelectItem value="CARD">Karta</SelectItem><SelectItem value="TRANSFER">O‘tkazma</SelectItem><SelectItem value="OTHER">Boshqa</SelectItem></SelectContent></Select></div>
            <label htmlFor="supplier-payable-payment-date" className="block text-xs font-medium text-zinc-700">To‘lov sanasi<DateInput id="supplier-payable-payment-date" value={paidAt} onValueChange={setPaidAt} className="mt-1.5" /></label>
          </div>
          <label htmlFor="supplier-payable-payment-split" className="flex items-center gap-2 text-sm text-zinc-700"><input id="supplier-payable-payment-split" type="checkbox" checked={split} onChange={(event) => setSplit(event.target.checked)} />Ikki usulda to‘lash</label>
          {split && <div className="grid gap-3 rounded-lg border border-zinc-200 p-3 sm:grid-cols-2">
            <MoneyInput aria-label="Birinchi usul summasi" currency={target.remainingAmount.currency} value={firstPart} onChange={setFirstPart} placeholder="1-usul summasi" />
            <div><Select value={secondMethod} onValueChange={(value) => value && setSecondMethod(value as PaymentMethod)}><SelectTrigger aria-label="Ikkinchi to‘lov usuli"><SelectValue /></SelectTrigger><SelectContent>{(['CASH', 'CARD', 'TRANSFER', 'OTHER'] as PaymentMethod[]).filter((option) => option !== method).map((option) => <SelectItem key={option} value={option}>{paymentMethodLabel(option)}</SelectItem>)}</SelectContent></Select><MoneyInput aria-label="Ikkinchi usul summasi" currency={target.remainingAmount.currency} value={secondPart} onChange={setSecondPart} placeholder="2-usul summasi" className="mt-2" /></div>
          </div>}
          <label htmlFor="supplier-payable-payment-note" className="block text-xs font-medium text-zinc-700">Izoh<Textarea id="supplier-payable-payment-note" value={note} onChange={(event) => setNote(event.target.value)} className="mt-1.5" /></label>
        </div>}
        <DialogFooter><Button variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>Bekor qilish</Button><AsyncButton pending={pending} pendingLabel="Saqlanmoqda…" onClick={submit}>To‘lovni saqlash</AsyncButton></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
