'use client'

import { useEffect, useState } from 'react'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useLogicalCommandIdempotency } from '@/lib/use-logical-command-idempotency'
import { useShopCurrency } from '@/lib/use-shop-currency'
import { commitNavigationMutation } from '@/lib/client-events'
import { displayImei } from '@/lib/device-display'
import { formatUzPhoneDisplay } from '@/lib/phone'
import { QueryActivity } from '@/components/query-activity'
import { AsyncButton } from '@/components/ui/async-button'
import { markQueryIntent } from '@/lib/client-performance'

interface ReturnCandidate {
  id: string
  model: string
  color: string | null
  storage: string | null
  imei: string
  status: 'SOLD_CASH' | 'SOLD_DEBT'
  contractType: 'SALE'
  contractId: string | null
  contractCurrency: 'UZS' | 'USD'
  customer: { name: string; phone: string } | null
}

async function apiError(response: Response) {
  try {
    const payload = await response.json()
    return payload.error ?? 'Xatolik yuz berdi'
  } catch {
    return 'Xatolik yuz berdi'
  }
}

export default function ReturnWorkQueue() {
  const { currency } = useShopCurrency()
  const command = useLogicalCommandIdempotency()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [committedSearch, setCommittedSearch] = useState('')
  const [selected, setSelected] = useState<ReturnCandidate | null>(null)
  const [note, setNote] = useState('')
  const [refundAmount, setRefundAmount] = useState('0')
  const [refundMethod, setRefundMethod] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')

  useEffect(() => {
    if (search.trim() === committedSearch) return
    const timer = window.setTimeout(() => {
      markQueryIntent('return-work-queue')
      setCommittedSearch(search.trim())
    }, 275)
    return () => window.clearTimeout(timer)
  }, [committedSearch, search])

  const candidatesQuery = useQuery({
    queryKey: ['return-work-queue', committedSearch],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ view: 'return-picker', take: '50' })
      if (committedSearch) params.set('search', committedSearch)
      const response = await fetch(`/api/devices?${params.toString()}`, { signal, cache: 'no-store' })
      if (!response.ok) throw new Error(await apiError(response))
      const payload = await response.json() as { data?: { items?: ReturnCandidate[] } }
      return payload.data?.items ?? []
    },
    placeholderData: keepPreviousData,
  })
  const items = candidatesQuery.data ?? []
  const loading = candidatesQuery.isPending
  const error = candidatesQuery.error instanceof Error ? candidatesQuery.error.message : ''

  function open(candidate: ReturnCandidate) {
    setSelected(candidate)
    setNote('')
    setRefundAmount('0')
    setRefundMethod('')
    setSubmitError('')
  }

  async function submit() {
    if (!selected || submitting) return
    const amount = Number(refundAmount || 0)
    if (note.trim().length < 5) {
      setSubmitError("Sabab kamida 5 ta belgidan iborat bo'lishi kerak")
      return
    }
    if (!Number.isFinite(amount) || amount < 0) {
      setSubmitError("Qaytariladigan summa manfiy bo'lmasligi kerak")
      return
    }
    if (amount > 0 && !refundMethod) {
      setSubmitError('Pul qaytarilsa, qaytarish usulini tanlang')
      return
    }
    const payload = {
      note: note.trim(),
      refundAmount: amount,
      refundMethod: amount > 0 ? refundMethod : undefined,
      inputCurrency: currency.currency,
    }
    setSubmitting(true)
    setSubmitError('')
    try {
      const response = await fetch(`/api/devices/${selected.id}/return`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': command.keyFor(payload),
        },
        body: JSON.stringify(payload),
      })
      if (!response.ok) {
        command.rejected(response.status)
        throw new Error(await apiError(response))
      }
      command.committed()
      await commitNavigationMutation({ kind: 'return.created', deviceId: selected.id })
      queryClient.setQueryData<ReturnCandidate[]>(
        ['return-work-queue', committedSearch],
        (current) => current?.filter((item) => item.id !== selected.id) ?? [],
      )
      setSelected(null)
    } catch (caught) {
      setSubmitError(caught instanceof Error ? caught.message : 'Qaytarishda xatolik')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
      <div>
        <h1 className="text-xl font-bold text-zinc-900">Sotuvni qaytarish</h1>
        <p className="mt-1 text-sm text-zinc-500">Qaytariladigan sotuvni tanlang</p>
      </div>

      <div className="max-w-xl">
        <Input aria-label="Qaytariladigan sotuvni qidirish" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Model, IMEI, mijoz yoki telefon" />
      </div>

      <QueryActivity
        isFetching={candidatesQuery.isFetching}
        isInitialLoading={loading && !candidatesQuery.data}
        error={error}
        onRetry={() => void candidatesQuery.refetch()}
        metricId="return-work-queue"
      >
      {loading ? (
        <div className="py-10 text-sm text-zinc-500">Yuklanmoqda...</div>
      ) : items.length === 0 ? (
        <div className="border border-dashed border-zinc-300 bg-white p-10 text-center text-sm text-zinc-500">Mos faol sotuv topilmadi</div>
      ) : (
        <div className="divide-y divide-zinc-200 border border-zinc-200 bg-white">
          {items.map((item) => (
            <div key={item.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="font-semibold text-zinc-900">{item.model}{item.storage ? ` · ${item.storage}` : ''}</div>
                <div className="mt-1 text-xs text-zinc-500">IMEI: {displayImei(item.imei)}</div>
                <div className="mt-1 text-sm text-zinc-600">
                  {item.customer?.name ?? 'Mijoz'}{item.customer?.phone ? ` · ${formatUzPhoneDisplay(item.customer.phone)}` : ''}
                </div>
              </div>
              <Button type="button" variant="outline" onClick={() => open(item)}>
                <Undo2 className="size-4" /> Sotuvni qaytarish
              </Button>
            </div>
          ))}
        </div>
      )}
      </QueryActivity>

      <Dialog open={selected !== null} onOpenChange={(openState) => { if (!openState && !submitting) setSelected(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Sotuvni qaytarish</DialogTitle>
            <DialogDescription>{selected?.model} · server amalda olingan puldan ortiq refundni qabul qilmaydi.</DialogDescription>
          </DialogHeader>
          {submitError && <div className="border border-red-200 bg-red-50 p-3 text-sm text-red-700">{submitError}</div>}
          <label htmlFor="return-refund-amount" className="space-y-1 text-sm"><span className="font-medium">Qaytariladigan summa ({currency.currency})</span><Input id="return-refund-amount" type="number" min="0" step={currency.currency === 'USD' ? '0.01' : '1'} value={refundAmount} onChange={(event) => setRefundAmount(event.target.value)} /></label>
          {Number(refundAmount || 0) > 0 && <label htmlFor="return-refund-method" className="space-y-1 text-sm"><span className="font-medium">Qaytarish usuli</span><select id="return-refund-method" value={refundMethod} onChange={(event) => setRefundMethod(event.target.value)} className="h-10 w-full border border-zinc-200 bg-white px-3"><option value="">Tanlang</option><option value="CASH">Naqd pul</option><option value="CARD">Karta orqali</option><option value="TRANSFER">Pul o‘tkazmasi</option><option value="OTHER">Boshqa</option></select></label>}
          <label htmlFor="return-note" className="space-y-1 text-sm"><span className="font-medium">Sabab</span><Textarea id="return-note" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Kamida 5 ta belgi" /></label>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={submitting} onClick={() => setSelected(null)}>Bekor qilish</Button>
            <AsyncButton type="button" variant="destructive" pending={submitting} pendingLabel="Tasdiqlanmoqda..." onClick={() => void submit()}>Tasdiqlash</AsyncButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
