'use client'

import { useEffect, useMemo, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { uzDate } from '@/lib/dates'
import { formatUzPhoneDisplay } from '@/lib/phone'
import type { CurrencyContext } from '@/lib/currency'
import { formatDisplayMoneyFromContract } from '@/lib/nasiya-contract'
import { NasiyaPaymentModal } from '@/components/shop/nasiya-payment-modal'
import { NasiyaDeferModal } from '@/components/shop/nasiya-defer-modal'
import { StretchedLink } from '@/components/ui/stretched-link'
import { replaceListUrlState } from '@/lib/list-url-state'
import type { PaymentScoreColor, PaymentScoreLabel } from '@/lib/nasiya-payment-score'
import { queryKeys } from '@/lib/query-keys'
import { useAuthenticatedQueryScope } from '@/components/query-scope-context'
import type { NasiyaStatus } from '@/lib/domain-types'
import { useShopAccess } from '@/components/shop/shop-access-context'

type DisplayStatus = 'Faol' | "Muddati o'tgan" | 'Yakunlangan' | 'Bekor qilingan'
type ResolutionState = 'ACTIVE' | 'ARCHIVED' | 'WRITTEN_OFF'
/** `DUE_TODAY` and `UPCOMING` are schedule-derived work-queue tabs. */
type NasiyaCohortTab = 'DUE_TODAY' | 'UPCOMING'
type ListFilter = NasiyaStatus | NasiyaCohortTab | Exclude<ResolutionState, 'ACTIVE'> | 'Barchasi'

interface NasiyaSchedule {
  id: string
  dueDate: string
  delayedUntil: string | null
  status: string
}

interface PaymentScore {
  score: number
  label: PaymentScoreLabel
  color: PaymentScoreColor
  reason: string
}

interface CollectionWorkItem {
  cohort: 'OVERDUE' | 'DUE_TODAY' | 'UPCOMING'
  outstanding: number
  effectiveDue: string
  preferredScheduleId: string
}

interface Nasiya {
  id: string
  totalAmount: number
  remainingAmount: number
  baseRemainingAmount: number
  interestPercent: number
  interestAmount: number
  finalNasiyaAmount: number
  // Native contract-currency ledger — see docs/currency-accounting-model.md.
  contractCurrency: 'UZS' | 'USD'
  contractInterestAmount: number
  contractFinalAmount: number
  contractRemainingAmount: number
  status: NasiyaStatus
  resolutionState: ResolutionState
  resolutionUpdatedAt: string | null
  isImported: boolean
  createdAt: string
  note: string | null
  /** Live display status derived server-side from schedules (matches dashboard). */
  displayStatus: NasiyaStatus
  isOverdue: boolean
  overdueAmount: number
  overdueCount: number
  nextPaymentDate: string | null
  device: { model: string; imei: string }
  customer: { name: string; phone: string }
  schedules: NasiyaSchedule[]
  /** Amount/date scoped to the selected work-queue tab, not whole contract debt. */
  collectionWorkItem: CollectionWorkItem | null
  paymentScore: PaymentScore
}

interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
}

interface NasiyalarPayload {
  items: Nasiya[]
  total: number
}

const statusMap: Record<NasiyaStatus, DisplayStatus> = {
  ACTIVE: 'Faol',
  OVERDUE: "Muddati o'tgan",
  COMPLETED: 'Yakunlangan',
  CANCELLED: 'Bekor qilingan',
}

const filterTabs: { label: string; value: ListFilter }[] = [
  { label: 'Barchasi', value: 'Barchasi' },
  { label: 'Barcha faol', value: 'ACTIVE' },
  { label: "Muddati o'tgan", value: 'OVERDUE' },
  { label: "Bugun to'lanadi", value: 'DUE_TODAY' },
  { label: 'Kutilmoqda', value: 'UPCOMING' },
  { label: 'Yakunlangan', value: 'COMPLETED' },
  { label: 'Bekor qilingan', value: 'CANCELLED' },
  { label: 'Arxivlangan', value: 'ARCHIVED' },
  { label: 'Hisobdan chiqarilgan', value: 'WRITTEN_OFF' },
]

function StatusBadge({ status }: { status: NasiyaStatus }) {
  const label = statusMap[status]
  const styles: Record<DisplayStatus, string> = {
    'Faol': 'bg-zinc-100 text-zinc-700',
    "Muddati o'tgan": 'bg-red-100 text-red-700',
    'Yakunlangan': 'bg-zinc-900 text-white',
    'Bekor qilingan': 'bg-zinc-200 text-zinc-500',
  }
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${styles[label]}`}>
      {label}
    </span>
  )
}

const collectionCohortLabels: Record<CollectionWorkItem['cohort'], string> = {
  OVERDUE: "Muddati o'tgan",
  DUE_TODAY: "Bugun to'lanadi",
  UPCOMING: 'Kutilmoqda',
}

function CollectionCohortBadge({ cohort }: { cohort: CollectionWorkItem['cohort'] }) {
  const styles: Record<CollectionWorkItem['cohort'], string> = {
    OVERDUE: 'bg-red-100 text-red-700',
    DUE_TODAY: 'bg-emerald-100 text-emerald-700',
    UPCOMING: 'bg-blue-100 text-blue-700',
  }
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${styles[cohort]}`}>
      {collectionCohortLabels[cohort]}
    </span>
  )
}

function ResolutionBadge({ state }: { state: Exclude<ResolutionState, 'ACTIVE'> }) {
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${
      state === 'WRITTEN_OFF'
        ? 'bg-red-100 text-red-800'
        : 'bg-blue-100 text-blue-800'
    }`}>
      {state === 'WRITTEN_OFF' ? 'Hisobdan chiqarilgan' : 'Arxivlangan'}
    </span>
  )
}

const scoreBadgeStyles: Record<PaymentScoreColor, string> = {
  green: 'bg-emerald-100 text-emerald-700',
  yellow: 'bg-amber-100 text-amber-700',
  red: 'bg-red-100 text-red-700',
  gray: 'bg-zinc-100 text-zinc-500',
}

function PaymentScoreBadge({ score }: { score: PaymentScore }) {
  return (
    <span
      title={score.reason}
      className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${scoreBadgeStyles[score.color]}`}
    >
      {score.label}
    </span>
  )
}

// Item — real page/skip/take pagination (matches /api/logs' established
// envelope, and mijozlar/logs' client-fetch pattern) — replaces the old
// single unbounded-in-spirit fetch capped at a fixed ceiling.
const PER_PAGE = 25

function buildRequestKey(search: string, filter: ListFilter, page: number) {
  const params = new URLSearchParams()
  if (search.trim()) params.set('search', search.trim())
  // The visible tab is a URL contract. It drives both the server-rendered
  // first page and later targeted client fetches, so a banner's Nasiya link
  // cannot drift into a different cohort after hydration.
  if (filter !== 'Barchasi') params.set('tab', filter)
  params.set('skip', String((page - 1) * PER_PAGE))
  params.set('take', String(PER_PAGE))
  return params.toString()
}

export default function NasiyalarClient({
  initialNasiyalar,
  initialTotal,
  initialFilter = 'Barchasi',
  initialSearch = '',
  initialPage = 1,
  currency,
}: {
  initialNasiyalar: Nasiya[]
  initialTotal: number
  initialFilter?: ListFilter
  initialSearch?: string
  initialPage?: number
  currency: CurrencyContext
}) {
  const scope = useAuthenticatedQueryScope()
  const { can, memberKind } = useShopAccess()
  const canCreate = can('NASIYA_CREATE')
  const canImport = can('IMPORT_OLD_NASIYA')
  const canViewResolutionHistory = memberKind === 'SHOP_OWNER' || can('NASIYA_ARCHIVE') || can('NASIYA_WRITE_OFF') || can('NASIYA_REOPEN')
  const canExport = can('EXPORT_NASIYA')
  const canReceivePayment = can('NASIYA_PAYMENT_RECEIVE')
  const canDeferNasiya = can('NASIYA_DEFER')
  const [page, setPage] = useState(initialPage)
  const [search, setSearch] = useState(initialSearch)
  const [debouncedSearch, setDebouncedSearch] = useState(initialSearch)
  const [activeFilter, setActiveFilter] = useState<ListFilter>(initialFilter)
  const [payFor, setPayFor] = useState<Nasiya | null>(null)
  const [deferFor, setDeferFor] = useState<Nasiya | null>(null)
  const initialRequestKey = useMemo(
    () => buildRequestKey(initialSearch, initialFilter, initialPage),
    [initialFilter, initialPage, initialSearch],
  )

  // Debounce the free-text search so typing doesn't fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  const requestKey = useMemo(
    () => buildRequestKey(debouncedSearch, activeFilter, page),
    [debouncedSearch, activeFilter, page],
  )

  useEffect(() => {
    replaceListUrlState({ q: debouncedSearch, tab: activeFilter, status: null, page })
  }, [activeFilter, debouncedSearch, page])

  const nasiyalarQuery = useQuery({
    queryKey: queryKeys.list(scope, 'nasiyas', {
      search: debouncedSearch,
      tab: activeFilter,
      page,
      take: PER_PAGE,
      sort: 'createdAt-desc',
    }),
    queryFn: async ({ signal }) => {
      const response = await fetch(`/api/nasiya?${requestKey}`, { signal, cache: 'no-store' })
      const json = await response.json() as ApiResponse<NasiyalarPayload>
      if (!response.ok || !json.success || !json.data) throw new Error(json.error || 'Nasiyalar yuklanmadi')
      return json.data
    },
    initialData: requestKey === initialRequestKey ? { items: initialNasiyalar, total: initialTotal } : undefined,
    placeholderData: keepPreviousData,
  })

  // Keep the existing list visible while the affected page refetches. The
  // incremental coordinator updates other query-backed surfaces separately.
  function handlePaymentSuccess() {
    void nasiyalarQuery.refetch()
  }

  const nasiyalar = nasiyalarQuery.data?.items ?? []
  const total = nasiyalarQuery.data?.total ?? 0
  const error = nasiyalarQuery.error instanceof Error ? nasiyalarQuery.error.message : ''
  const loading = nasiyalarQuery.isPending && !nasiyalarQuery.data
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE))

  return (
    <div className="p-6 space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-zinc-900">Nasiyalar</h1>
          <p className="text-sm text-zinc-500 mt-0.5">Barcha nasiya shartnomalar</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canExport && (
            <Button
              type="button"
              size="lg"
              variant="outline"
              onClick={() => { window.location.href = '/api/export/nasiya?format=xlsx' }}
            >
              Excel yuklab olish
            </Button>
          )}
          {canImport && (
            <Button render={<Link href="/shop/nasiyalar/import" />} size="lg" variant="outline">
              + Eski nasiya kiritish
            </Button>
          )}
          {canCreate && (
            <Button render={<Link href="/shop/nasiyalar/new" />} size="lg">
              + Yangi nasiya
            </Button>
          )}
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 overflow-x-auto border-b border-zinc-200">
        {filterTabs
          .filter((tab) => canViewResolutionHistory || (tab.value !== 'ARCHIVED' && tab.value !== 'WRITTEN_OFF'))
          .map((tab) => (
          <button
            key={tab.value}
            onClick={() => { setActiveFilter(tab.value); setPage(1) }}
            className={`-mb-px shrink-0 border-b-2 px-3 py-2 text-sm transition-colors ${
              activeFilter === tab.value
                ? 'border-zinc-900 text-zinc-900 font-medium'
                : 'border-transparent text-zinc-500 hover:text-zinc-700'
            }`}
          >
            {tab.label}
          </button>
          ))}
      </div>

      {/* Search */}
      <Input
        value={search}
        onChange={(e) => { setSearch(e.target.value); setPage(1) }}
        placeholder="Mijoz, telefon, qurilma yoki IMEI bo'yicha qidirish..."
        className="max-w-md h-9 text-sm border-zinc-200 rounded"
      />

      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-4 py-3">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-zinc-400 py-8 text-center">Yuklanmoqda...</div>
      ) : (
        <>
          {/* Desktop list — unchanged rendering, just gated to sm: and up. */}
          <div className="hidden sm:block space-y-2">
            {nasiyalar.map((n) => {
              const paidAmount = n.finalNasiyaAmount - n.remainingAmount
              const pct = n.finalNasiyaAmount > 0 ? Math.round((paidAmount / n.finalNasiyaAmount) * 100) : 0
              // Money TEXT must convert from the deal's own contract currency via
              // today's rate — never reconvert the legacy UZS snapshot (frozen at
              // creation rate), which drifts for a USD contract as the rate moves.
              // See docs/currency-accounting-model.md.
              const dfmt = (amount: number) => formatDisplayMoneyFromContract(amount, n.contractCurrency, currency.currency, currency.usdUzsRate)
              const contractPaidAmount = n.contractFinalAmount - n.contractRemainingAmount
              const collectionWorkItem = n.collectionWorkItem
              // A due-today schedule remains due today even if this same
              // contract has a different older schedule. The queue badge and
              // amount describe the selected obligation; the secondary note
              // keeps the older debt visible without mislabelling this one.
              const isOverdue = collectionWorkItem ? collectionWorkItem.cohort === 'OVERDUE' : n.isOverdue
              const collectionDateLabel = collectionWorkItem
                ? `${collectionCohortLabels[collectionWorkItem.cohort]}: ${uzDate(collectionWorkItem.effectiveDue)}`
                : n.nextPaymentDate ? `Keyingi to'lov: ${uzDate(n.nextPaymentDate)}` : null
              const canPay = canReceivePayment && n.resolutionState === 'ACTIVE' && (n.displayStatus === 'ACTIVE' || n.displayStatus === 'OVERDUE') && n.remainingAmount > 0
              const canDefer = canDeferNasiya && n.resolutionState === 'ACTIVE' && (n.displayStatus === 'ACTIVE' || n.displayStatus === 'OVERDUE') && n.remainingAmount > 0
              return (
                <div
                  key={n.id}
                  className={`relative border border-zinc-200 rounded p-4 hover:bg-zinc-50 transition-colors ${
                    isOverdue ? 'border-l-2 border-l-red-500 pl-4' : ''
                  }`}
                >
                  <StretchedLink href={`/shop/nasiyalar/${n.id}`} aria-label={`${n.customer.name} nasiyasini ochish`}>
                    <span className="sr-only">{n.customer.name} nasiyasini ochish</span>
                  </StretchedLink>
                  <div className="relative z-10 flex items-start justify-between gap-4">
                    <div className="pointer-events-none flex-1 min-w-0">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium text-sm text-zinc-900">{n.customer.name}</span>
                          {collectionWorkItem ? <CollectionCohortBadge cohort={collectionWorkItem.cohort} /> : <StatusBadge status={n.displayStatus} />}
                          {collectionWorkItem?.cohort === 'DUE_TODAY' && n.isOverdue && (
                            <span className="inline-block rounded bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
                              Shartnomada eski qarz bor
                            </span>
                          )}
                          {n.resolutionState !== 'ACTIVE' && <ResolutionBadge state={n.resolutionState} />}
                          <PaymentScoreBadge score={n.paymentScore} />
                          {n.isImported && (
                            <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">
                              Eski nasiya
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-zinc-500 mb-2">
                          {n.device.model} · {formatUzPhoneDisplay(n.customer.phone)}
                          {collectionDateLabel && <> · {collectionDateLabel}</>}
                        </div>

                        {/* Progress */}
                        <div className="flex items-center gap-2">
                          <div className="flex-1 w-full bg-zinc-100 h-1.5 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-zinc-900 rounded-full"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="text-xs text-zinc-500 whitespace-nowrap">{pct}%</span>
                        </div>
                        <div className="flex gap-3 mt-1 text-xs text-zinc-500">
                          <span>To'langan: {dfmt(contractPaidAmount)}</span>
                          <span>·</span>
                          <span>Nasiya jami: {dfmt(n.contractFinalAmount)}</span>
                          {n.contractInterestAmount > 0 && (
                            <>
                              <span>·</span>
                              <span>Foiz: {dfmt(n.contractInterestAmount)}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="relative z-10 text-right flex-shrink-0 space-y-2">
                      {collectionWorkItem && (
                        <div>
                          <div className={`text-sm font-bold ${collectionWorkItem.cohort === 'OVERDUE' ? 'text-red-700' : collectionWorkItem.cohort === 'DUE_TODAY' ? 'text-emerald-700' : 'text-blue-700'}`}>
                            {dfmt(collectionWorkItem.outstanding)}
                          </div>
                          <div className="mt-0.5 text-xs text-zinc-400">{collectionCohortLabels[collectionWorkItem.cohort]}</div>
                        </div>
                      )}
                      <div>
                        <div className="text-sm font-bold text-zinc-900">{dfmt(n.contractRemainingAmount)}</div>
                        <div className="text-xs text-zinc-400 mt-0.5">{collectionWorkItem ? 'shartnoma qoldig\'i' : 'qolgan'}</div>
                      </div>
                      {canPay && (
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => setPayFor(n)}
                          className="w-full whitespace-nowrap"
                        >
                          To&apos;lov qabul qilish
                        </Button>
                      )}
                      {canDefer && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => setDeferFor(n)}
                          className="w-full whitespace-nowrap"
                        >
                          Muddatni uzaytirish
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
            {nasiyalar.length === 0 && (
              <div className="text-center py-12 text-zinc-400 text-sm">Nasiya topilmadi</div>
            )}
          </div>

          {/* Mobile card view — the card opens the detail; operational actions
              stay directly visible instead of moving into an overflow menu. */}
          <div className="sm:hidden space-y-3">
            {nasiyalar.map((n) => {
              const dfmt = (amount: number) => formatDisplayMoneyFromContract(amount, n.contractCurrency, currency.currency, currency.usdUzsRate)
              const collectionWorkItem = n.collectionWorkItem
              const isOverdue = collectionWorkItem ? collectionWorkItem.cohort === 'OVERDUE' : n.isOverdue
              const collectionDateLabel = collectionWorkItem
                ? `${collectionCohortLabels[collectionWorkItem.cohort]}: ${uzDate(collectionWorkItem.effectiveDue)}`
                : n.nextPaymentDate ? `Keyingi to'lov: ${uzDate(n.nextPaymentDate)}` : '—'
              const canPay = canReceivePayment && n.resolutionState === 'ACTIVE' && (n.displayStatus === 'ACTIVE' || n.displayStatus === 'OVERDUE') && n.remainingAmount > 0
              const canDefer = canDeferNasiya && n.resolutionState === 'ACTIVE' && (n.displayStatus === 'ACTIVE' || n.displayStatus === 'OVERDUE') && n.remainingAmount > 0
              return (
                <div
                  key={n.id}
                  className={`relative space-y-2 rounded border border-zinc-200 p-3 ${isOverdue ? 'border-l-2 border-l-red-500' : ''}`}
                >
                  <StretchedLink href={`/shop/nasiyalar/${n.id}`} aria-label={`${n.customer.name} nasiyasini ochish`}>
                    <span className="sr-only">{n.customer.name} nasiyasini ochish</span>
                  </StretchedLink>
                  <div className="pointer-events-none relative z-10 flex items-start justify-between gap-2">
                    <div>
                      <div className="font-medium text-zinc-900">{n.customer.name}</div>
                      <div className="text-xs font-mono text-zinc-500 mt-0.5">{formatUzPhoneDisplay(n.customer.phone)}</div>
                    </div>
                    <div className="flex flex-wrap justify-end gap-1">
                      {collectionWorkItem ? <CollectionCohortBadge cohort={collectionWorkItem.cohort} /> : <StatusBadge status={n.displayStatus} />}
                      {collectionWorkItem?.cohort === 'DUE_TODAY' && n.isOverdue && (
                        <span className="inline-block rounded bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">Eski qarz bor</span>
                      )}
                    </div>
                  </div>
                  <div className="pointer-events-none relative z-10 text-xs text-zinc-500">{n.device.model}</div>
                  <div className="pointer-events-none relative z-10 flex flex-wrap items-center gap-2">
                    <PaymentScoreBadge score={n.paymentScore} />
                    {n.isImported && (
                      <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">
                        Eski nasiya
                      </span>
                    )}
                    {n.resolutionState !== 'ACTIVE' && <ResolutionBadge state={n.resolutionState} />}
                    {isOverdue && !collectionWorkItem && (
                      <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">
                        Muddati o&apos;tgan
                      </span>
                    )}
                  </div>
                  <div className="pointer-events-none relative z-10 flex items-center justify-between text-xs text-zinc-500">
                    <span>{collectionDateLabel}</span>
                    <span className={`font-bold text-sm ${collectionWorkItem?.cohort === 'OVERDUE' ? 'text-red-700' : collectionWorkItem?.cohort === 'DUE_TODAY' ? 'text-emerald-700' : 'text-zinc-900'}`}>
                      {dfmt(collectionWorkItem?.outstanding ?? n.contractRemainingAmount)} {collectionWorkItem ? collectionCohortLabels[collectionWorkItem.cohort] : 'qolgan'}
                    </span>
                  </div>
                  {collectionWorkItem && (
                    <div className="pointer-events-none relative z-10 text-right text-xs text-zinc-500">
                      Shartnoma qoldig'i: {dfmt(n.contractRemainingAmount)}
                    </div>
                  )}
                  {(canPay || canDefer) && (
                  <div className="relative z-10 flex items-center gap-2">
                    {canPay && (
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => setPayFor(n)}
                        className="flex-1 whitespace-nowrap"
                      >
                        To&apos;lov qabul qilish
                      </Button>
                    )}
                    {canDefer && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setDeferFor(n)}
                        className="flex-1 whitespace-nowrap"
                      >
                        Uzaytirish
                      </Button>
                    )}
                  </div>
                  )}
                </div>
              )
            })}
            {nasiyalar.length === 0 && (
              <div className="text-center py-12 text-zinc-400 text-sm">Nasiya topilmadi</div>
            )}
          </div>
        </>
      )}

      {total > 0 && (
        <div className="flex flex-col gap-2 text-sm text-zinc-500 sm:flex-row sm:items-center sm:justify-between">
          <span>
            {total} ta nasiyadan {Math.min((page - 1) * PER_PAGE + 1, total)}-{Math.min(page * PER_PAGE, total)} ko&apos;rsatilmoqda
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              disabled={page === 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="h-8 rounded border-zinc-200 px-3 text-xs disabled:opacity-40"
            >
              Oldingi
            </Button>
            <span className="text-xs">{page} / {totalPages}</span>
            <Button
              variant="outline"
              disabled={page === totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="h-8 rounded border-zinc-200 px-3 text-xs disabled:opacity-40"
            >
              Keyingi
            </Button>
          </div>
        </div>
      )}

      {canReceivePayment && (
        <NasiyaPaymentModal
          nasiyaId={payFor?.id ?? ''}
          open={payFor !== null}
          onOpenChange={(o) => { if (!o) setPayFor(null) }}
          customerName={payFor?.customer.name}
          deviceName={payFor?.device.model}
          preferredScheduleId={payFor?.collectionWorkItem?.preferredScheduleId}
          onSuccess={handlePaymentSuccess}
        />
      )}
      {canDeferNasiya && (
        <NasiyaDeferModal
          nasiyaId={deferFor?.id ?? ''}
          open={deferFor !== null}
          onOpenChange={(open) => { if (!open) setDeferFor(null) }}
          customerName={deferFor?.customer.name}
          deviceName={deferFor?.device.model}
          preferredScheduleId={deferFor?.collectionWorkItem?.preferredScheduleId}
          onSuccess={handlePaymentSuccess}
        />
      )}
    </div>
  )
}
