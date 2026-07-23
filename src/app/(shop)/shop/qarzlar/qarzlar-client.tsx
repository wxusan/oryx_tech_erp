'use client'

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { QueryActivity } from '@/components/query-activity'
import { formatMoneyDto, type MoneyDto } from '@/lib/currency'
import { paymentMethodLabel } from '@/lib/presentation-labels'
import { uzDate, uzDateTime } from '@/lib/dates'
import { formatUzPhoneDisplay } from '@/lib/phone'
import type { DebtQueryResult, DebtStatusFilter, DebtTab } from '@/lib/server/debts'
import { queryKeys } from '@/lib/query-keys'
import { useAuthenticatedQueryScope } from '@/components/query-scope-context'
import { SupplierPayablePaymentDialog } from '@/components/shop/supplier-payable-payment-dialog'
import { ImageViewer, useImageViewer } from '@/components/ui/image-viewer'
import { ImageViewerTrigger } from '@/components/ui/image-viewer-trigger'
import {
  HighlightedText,
  SearchEvidence,
  searchEvidenceFor,
  type SearchEvidenceCarrier,
} from '@/components/highlighted-text'

type OutgoingResult = Extract<DebtQueryResult, { tab: 'outgoing' }>
type IncomingResult = Extract<DebtQueryResult, { tab: 'incoming' }>
type OutgoingItem = OutgoingResult['items'][number] & SearchEvidenceCarrier
type IncomingItem = IncomingResult['items'][number] & SearchEvidenceCarrier
type DebtPayload = DebtQueryResult & SearchEvidenceCarrier & { matchEvidenceById?: unknown }

const statusLabels: Record<string, string> = {
  PENDING: 'Kutilmoqda',
  PARTIAL: 'Qisman to‘langan',
  OVERDUE: 'Muddati o‘tgan',
}

function subscribeOnlineStatus(callback: () => void) {
  window.addEventListener('online', callback)
  window.addEventListener('offline', callback)
  return () => {
    window.removeEventListener('online', callback)
    window.removeEventListener('offline', callback)
  }
}

function onlineSnapshot() {
  return navigator.onLine
}

function onlineServerSnapshot() {
  return true
}

function timingText(timeline: { days: number; timing: string }) {
  if (timeline.timing === 'DUE_TODAY') return 'Muddat bugun'
  if (timeline.days < 0) return `${Math.abs(timeline.days)} kun kechikkan`
  return `${timeline.days} kun qoldi`
}

function AmountSummary({ original, paid, remaining }: { original: MoneyDto; paid: MoneyDto; remaining: MoneyDto }) {
  return (
    <div className="grid grid-cols-3 gap-2 rounded-lg bg-zinc-50 p-3 text-xs">
      <div><span className="block text-zinc-500">Jami</span><strong className="text-zinc-800">{formatMoneyDto(original)}</strong></div>
      <div><span className="block text-zinc-500">To‘langan</span><strong className="text-emerald-700">{formatMoneyDto(paid)}</strong></div>
      <div><span className="block text-zinc-500">Qolgan</span><strong className="text-red-700">{formatMoneyDto(remaining)}</strong></div>
    </div>
  )
}

function DevicePicture({
  item,
  onExpand,
}: {
  item: { model: string; imageUrls: string[] }
  onExpand: (trigger: HTMLButtonElement) => void
}) {
  const imageUrl = item.imageUrls[0]
  return (
    <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-zinc-100">
      {imageUrl
        ? <>
            <Image src={imageUrl} alt={`${item.model} qurilmasi`} fill sizes="80px" unoptimized className="object-cover" />
            <ImageViewerTrigger label={`${item.model} rasmlarini kattalashtirish`} onClick={onExpand} />
          </>
        : <div className="flex h-full items-center justify-center px-2 text-center text-xs text-zinc-400">Rasm yo‘q</div>}
    </div>
  )
}

function PaymentHistory({ payments }: { payments: Array<{ id: string; amount: MoneyDto; method: string; paidAt: string }> }) {
  if (!payments.length) return null
  return (
    <details className="text-xs text-zinc-600">
      <summary className="cursor-pointer font-medium text-zinc-700">Oxirgi to‘lovlar</summary>
      <div className="mt-2 space-y-1.5 border-l border-zinc-200 pl-3">
        {payments.map((payment) => (
          <div key={payment.id} className="flex justify-between gap-3">
            <span>{uzDateTime(payment.paidAt)} · {paymentMethodLabel(payment.method)}</span>
            <strong>{formatMoneyDto(payment.amount)}</strong>
          </div>
        ))}
      </div>
    </details>
  )
}

export default function QarzlarClient({
  initialData,
  initialTab,
  initialMonth,
  initialStatus,
  canOutgoing,
  canIncoming,
  canPayOutgoing,
  canReceiveIncoming,
  canViewDevice,
  canOpenPayableDevice,
  canViewCustomer,
}: {
  initialData: DebtQueryResult
  initialTab: DebtTab
  initialMonth: string
  initialStatus: DebtStatusFilter
  canOutgoing: boolean
  canIncoming: boolean
  canPayOutgoing: boolean
  canReceiveIncoming: boolean
  canViewDevice: boolean
  canOpenPayableDevice: boolean
  canViewCustomer: boolean
}) {
  const scope = useAuthenticatedQueryScope()
  const firstSearchEffect = useRef(true)
  const [tab, setTab] = useState(initialTab)
  const [month, setMonth] = useState(initialMonth)
  const [status, setStatus] = useState(initialStatus)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [searchRevision, setSearchRevision] = useState(0)
  const [cursorStack, setCursorStack] = useState<Array<string | null>>([null])
  const cursor = cursorStack.at(-1) ?? null
  const [payable, setPayable] = useState<OutgoingItem | null>(null)
  const [viewerDevice, setViewerDevice] = useState<{ id: string; model: string; imageUrls: string[] } | null>(null)
  const imageViewer = useImageViewer()

  function openDeviceImages(
    device: { id: string; model: string; imageUrls: string[] },
    trigger: HTMLButtonElement,
  ) {
    setViewerDevice(device)
    imageViewer.openAt(0, trigger)
  }

  useEffect(() => {
    if (firstSearchEffect.current) {
      firstSearchEffect.current = false
      return
    }
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim())
      setSearchRevision((value) => value + 1)
      setCursorStack([null])
    }, 275)
    return () => window.clearTimeout(timer)
  }, [search])

  useEffect(() => {
    const params = new URLSearchParams({ tab, month, status: status.toLowerCase() })
    window.history.replaceState(null, '', `/shop/qarzlar?${params.toString()}`)
  }, [month, status, tab])

  const query = useQuery({
    queryKey: queryKeys.list(scope, 'debts', { tab, month, status, cursor, searchRevision }),
    queryFn: async ({ signal }) => {
      const response = await fetch('/api/debts/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tab, month, status, cursor: cursor ?? undefined, search: debouncedSearch || undefined, take: 18 }),
        signal,
        cache: 'no-store',
      })
      const json = await response.json() as { success?: boolean; data?: DebtPayload; error?: string }
      if (!response.ok || !json.success || !json.data) throw new Error(json.error || 'Qarzlar yuklanmadi')
      return json.data
    },
    initialData: initialData.tab === tab && month === initialMonth && status === initialStatus && !cursor && searchRevision === 0 ? initialData as DebtPayload : undefined,
    placeholderData: keepPreviousData,
  })
  const data = query.data
  const activeData = data?.tab === tab ? data : null
  const items = activeData?.items ?? []
  const nextCursor = activeData?.nextCursor ?? null
  const filtered = Boolean(debouncedSearch) || status !== 'ALL'
  const offline = !useSyncExternalStore(subscribeOnlineStatus, onlineSnapshot, onlineServerSnapshot)
  const highlightQuery = search.trim() === debouncedSearch && !query.isPlaceholderData
    ? debouncedSearch
    : ''

  function changeTab(next: DebtTab) {
    if ((next === 'outgoing' && !canOutgoing) || (next === 'incoming' && !canIncoming)) return
    setTab(next)
    setCursorStack([null])
  }

  function openPayment(item: OutgoingItem) {
    setPayable(item)
  }

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <div>
        <h1 className="text-xl font-bold text-zinc-900">Qarzlarim</h1>
        <p className="mt-1 text-sm text-zinc-500">Yetkazib beruvchilarga qarzimiz va mijozlarning Pay Later qarzlari</p>
      </div>

      <div className="grid grid-cols-2 rounded-xl bg-zinc-100 p-1" role="tablist" aria-label="Qarz turlari">
        {canOutgoing && <button type="button" role="tab" aria-selected={tab === 'outgoing'} onClick={() => changeTab('outgoing')} className={`rounded-lg px-3 py-2.5 text-sm font-semibold ${tab === 'outgoing' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500'}`}>Bizning qarzlarimiz</button>}
        {canIncoming && <button type="button" role="tab" aria-selected={tab === 'incoming'} onClick={() => changeTab('incoming')} className={`rounded-lg px-3 py-2.5 text-sm font-semibold ${tab === 'incoming' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500'}`}>Bizga qarzlar</button>}
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_220px_170px]">
        <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={tab === 'outgoing' ? 'Yetkazib beruvchi, model yoki IMEI…' : 'Mijoz, model yoki IMEI…'} aria-label="Qarzlardan qidirish" />
        <div className="flex gap-2">
          <Input type="month" value={month === 'ALL' ? '' : month} onChange={(event) => { if (event.target.value) setMonth(event.target.value); setCursorStack([null]) }} aria-label="Muddat oyi" className="min-w-0" />
          <Button type="button" variant={month === 'ALL' ? 'default' : 'outline'} onClick={() => { setMonth('ALL'); setCursorStack([null]) }}>Barchasi</Button>
        </div>
        <Select value={status} onValueChange={(value) => { if (value) { setStatus(value as DebtStatusFilter); setCursorStack([null]) } }}>
          <SelectTrigger aria-label="Qarz holati"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Barcha ochiq</SelectItem>
            <SelectItem value="PENDING">To‘lov kutilmoqda</SelectItem>
            <SelectItem value="PARTIAL">Qisman to‘langan</SelectItem>
            <SelectItem value="OVERDUE">Muddati o‘tgan</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <QueryActivity isFetching={query.isFetching} isInitialLoading={query.isPending} error={query.error instanceof Error ? query.error.message : ''} onRetry={() => void query.refetch()} metricId="debts-list">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-busy={query.isFetching} role="tabpanel">
          {!query.isPending && items.length === 0 && (
            <div className="col-span-full rounded-xl border border-dashed border-zinc-300 bg-zinc-50 px-5 py-12 text-center">
              <p className="font-medium text-zinc-700">{offline ? 'Internet aloqasi yo‘q' : filtered ? 'Filtrga mos qarz topilmadi' : month === 'ALL' ? 'Ochiq qarz yo‘q' : 'Bu oy uchun ochiq qarz yo‘q'}</p>
              <p className="mt-1 text-sm text-zinc-500">{filtered ? 'Qidiruv yoki holat filtrini tozalab ko‘ring.' : month === 'ALL' ? 'Yangi Pay Later qarzi yaratilganda shu yerda ko‘rinadi.' : 'Boshqa muddat oyini tanlashingiz mumkin.'}</p>
            </div>
          )}
          {tab === 'outgoing' && (items as OutgoingItem[]).map((item) => (
            <article key={item.id} className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
              <div className="flex gap-3">
                <DevicePicture item={item.device} onExpand={(trigger) => openDeviceImages(item.device, trigger)} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2"><h2 className="truncate font-semibold text-zinc-900"><HighlightedText value={item.device.model} query={highlightQuery} mode="text" /></h2><span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${item.status === 'OVERDUE' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800'}`}>{statusLabels[item.status] ?? item.status}</span></div>
                  <p className="mt-0.5 text-xs text-zinc-500"><HighlightedText value={item.device.storage || '—'} query={highlightQuery} mode="auto" /> · IMEI <HighlightedText value={item.device.imei} query={highlightQuery} mode="identifier" /></p>
                  <p className="mt-2 text-sm font-medium text-zinc-800"><HighlightedText value={item.supplier.name} query={highlightQuery} mode="text" /></p>
                  <p className="text-xs text-zinc-500"><HighlightedText value={formatUzPhoneDisplay(item.supplier.phone)} query={highlightQuery} mode="identifier" /></p>
                  <SearchEvidence evidence={searchEvidenceFor(item.id, item, activeData)} query={highlightQuery} />
                </div>
              </div>
              <AmountSummary original={item.originalAmount} paid={item.paidAmount} remaining={item.remainingAmount} />
              <div className="flex items-center justify-between text-sm"><span className="text-zinc-500">Muddat: {uzDate(item.dueDate)}</span><strong className={item.timeline.days < 0 ? 'text-red-700' : 'text-zinc-700'}>{timingText(item.timeline)}</strong></div>
              <p className="text-xs text-zinc-500">Manba: {item.origin === 'DEVICE_PURCHASE' ? 'Qurilma xaridi' : 'Olib-sotdim'}</p>
              <PaymentHistory payments={item.payments} />
              <div className="flex gap-2">
                {canPayOutgoing && <Button onClick={() => openPayment(item)} className="flex-1">To‘lov qilish</Button>}
                {canOpenPayableDevice && <Button variant="outline" render={<Link href={`/shop/qurilmalar/${item.device.id}`} />} nativeButton={false}>Qurilma</Button>}
              </div>
            </article>
          ))}
          {tab === 'incoming' && (items as IncomingItem[]).map((item) => (
            <article key={item.id} className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
              <div className="flex gap-3">
                <DevicePicture item={item.device} onExpand={(trigger) => openDeviceImages(item.device, trigger)} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2"><h2 className="truncate font-semibold text-zinc-900"><HighlightedText value={item.device.model} query={highlightQuery} mode="text" /></h2><span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${item.status === 'OVERDUE' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-800'}`}>{statusLabels[item.status]}</span></div>
                  <p className="mt-0.5 text-xs text-zinc-500"><HighlightedText value={item.device.storage || '—'} query={highlightQuery} mode="auto" /> · IMEI <HighlightedText value={item.device.imei} query={highlightQuery} mode="identifier" /></p>
                  <p className="mt-2 text-sm font-medium text-zinc-800"><HighlightedText value={item.customer.name} query={highlightQuery} mode="text" /></p>
                  <p className="text-xs text-zinc-500"><HighlightedText value={formatUzPhoneDisplay(item.customer.phone)} query={highlightQuery} mode="identifier" /></p>
                  <SearchEvidence evidence={searchEvidenceFor(item.id, item, activeData)} query={highlightQuery} />
                </div>
              </div>
              <AmountSummary original={item.originalAmount} paid={item.paidAmount} remaining={item.remainingAmount} />
              <div className="flex items-center justify-between text-sm"><span className="text-zinc-500">Muddat: {uzDate(item.dueDate)}</span><strong className={item.timeline.days < 0 ? 'text-red-700' : 'text-zinc-700'}>{timingText(item.timeline)}</strong></div>
              <p className="text-xs text-zinc-500">Manba: {item.origin === 'OLIB_SOTDIM_SALE' ? 'Olib-sotdim Sotuv' : 'Oddiy Sotuv Pay Later'}</p>
              <PaymentHistory payments={item.payments} />
              <div className="flex gap-2">
                {canReceiveIncoming && <Button render={<Link href={`/shop/qurilmalar/${item.device.id}?action=sale-payment`} />} nativeButton={false} className="flex-1">To‘lov qabul qilish</Button>}
                {canViewDevice && <Button variant="outline" render={<Link href={`/shop/qurilmalar/${item.device.id}`} />} nativeButton={false}>Qurilma</Button>}
                {canViewCustomer && <Button variant="outline" render={<Link href={`/shop/mijozlar/${item.customer.id}`} />} nativeButton={false}>Mijoz</Button>}
              </div>
            </article>
          ))}
        </div>
      </QueryActivity>

      <div className="flex items-center justify-between">
        <Button variant="outline" disabled={cursorStack.length === 1 || query.isFetching} onClick={() => setCursorStack((stack) => stack.slice(0, -1))}>Oldingi</Button>
        <span className="text-xs text-zinc-500">{cursorStack.length}-sahifa</span>
        <Button variant="outline" disabled={!nextCursor || query.isFetching} onClick={() => nextCursor && setCursorStack((stack) => [...stack, nextCursor])}>Keyingi</Button>
      </div>

      <SupplierPayablePaymentDialog
        target={payable ? { id: payable.id, deviceId: payable.device.id, remainingAmount: payable.remainingAmount } : null}
        open={Boolean(payable)}
        onOpenChange={(open) => !open && setPayable(null)}
        onPaid={async () => { await query.refetch() }}
      />
      <ImageViewer
        images={(viewerDevice?.imageUrls ?? []).map((imageUrl, index) => ({
          id: `${viewerDevice?.id ?? 'device'}-${index}`,
          src: imageUrl,
          alt: `${viewerDevice?.model ?? 'Qurilma'} rasmi ${index + 1}`,
        }))}
        open={imageViewer.open}
        activeIndex={imageViewer.activeIndex}
        onOpenChange={imageViewer.onOpenChange}
        onActiveIndexChange={imageViewer.onActiveIndexChange}
        finalFocusRef={imageViewer.finalFocusRef}
        title={`${viewerDevice?.model ?? 'Qurilma'} rasmlari`}
      />
    </div>
  )
}
