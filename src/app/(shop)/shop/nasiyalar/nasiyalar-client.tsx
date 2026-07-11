'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { uzDate } from '@/lib/dates'
import { formatUzPhoneDisplay } from '@/lib/phone'
import type { CurrencyContext } from '@/lib/currency'
import { formatDisplayMoneyFromContract } from '@/lib/nasiya-contract'
import { NasiyaPaymentModal } from '@/components/shop/nasiya-payment-modal'
import type { PaymentScoreColor, PaymentScoreLabel } from '@/lib/nasiya-payment-score'

type NasiyaStatus = 'ACTIVE' | 'OVERDUE' | 'COMPLETED' | 'CANCELLED'
type DisplayStatus = 'Faol' | "Muddati o'tgan" | 'Yakunlangan' | 'Bekor qilingan'

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

const filterTabs: { label: string; value: NasiyaStatus | 'Barchasi' }[] = [
  { label: 'Barchasi', value: 'Barchasi' },
  { label: 'Faol', value: 'ACTIVE' },
  { label: "Muddati o'tgan", value: 'OVERDUE' },
  { label: 'Yakunlangan', value: 'COMPLETED' },
  { label: 'Bekor qilingan', value: 'CANCELLED' },
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

function buildRequestKey(search: string, filter: NasiyaStatus | 'Barchasi', page: number) {
  const params = new URLSearchParams()
  if (search.trim()) params.set('search', search.trim())
  // Filtering happens server-side (GET /api/nasiya) on the native
  // contract-derived display status, never the lagging raw parent column.
  if (filter !== 'Barchasi') params.set('status', filter)
  params.set('skip', String((page - 1) * PER_PAGE))
  params.set('take', String(PER_PAGE))
  return params.toString()
}

export default function NasiyalarClient({
  initialNasiyalar,
  initialTotal,
  initialFilter = 'Barchasi',
  currency,
}: {
  initialNasiyalar: Nasiya[]
  initialTotal: number
  initialFilter?: NasiyaStatus | 'Barchasi'
  currency: CurrencyContext
}) {
  const router = useRouter()
  const [nasiyalar, setNasiyalar] = useState<Nasiya[]>(initialNasiyalar)
  const [total, setTotal] = useState(initialTotal)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [activeFilter, setActiveFilter] = useState<NasiyaStatus | 'Barchasi'>(initialFilter)
  const [error, setError] = useState('')
  const [loadedKey, setLoadedKey] = useState(() => buildRequestKey('', initialFilter, 1))
  const [payFor, setPayFor] = useState<Nasiya | null>(null)

  // Debounce the free-text search so typing doesn't fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  const requestKey = useMemo(
    () => buildRequestKey(debouncedSearch, activeFilter, page),
    [debouncedSearch, activeFilter, page],
  )

  function loadNasiyalar(key: string) {
    const controller = new AbortController()
    fetch(`/api/nasiya?${key}`, { signal: controller.signal })
      .then((res) => res.json())
      .then((json: ApiResponse<NasiyalarPayload>) => {
        if (!json.success || !json.data) {
          setError(json.error || 'Nasiyalar yuklanmadi')
          setLoadedKey(key)
          return
        }
        setError('')
        setNasiyalar(json.data.items)
        setTotal(json.data.total)
        setLoadedKey(key)
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return
        setError('Nasiyalar yuklanmadi')
        setLoadedKey(key)
      })
    return controller
  }

  useEffect(() => {
    if (loadedKey === requestKey) return
    const controller = loadNasiyalar(requestKey)
    return () => controller.abort()
  }, [loadedKey, requestKey])

  // A payment doesn't change page/filter/search, so the requestKey-based
  // effect above never refires on its own — refetch the current page
  // directly, and keep router.refresh() so any other server-rendered
  // surface (e.g. dashboard) that reads this shop's nasiya data also updates.
  function handlePaymentSuccess() {
    router.refresh()
    loadNasiyalar(requestKey)
  }

  const loading = loadedKey !== requestKey
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE))

  return (
    <div className="p-6 space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-zinc-900">Nasiyalar</h1>
          <p className="text-sm text-zinc-500 mt-0.5">Barcha nasiya shartnomalar</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => { window.location.href = '/api/export/nasiya?format=xlsx' }}
            className="h-9 px-4 text-sm bg-zinc-900 hover:bg-zinc-800 text-white rounded transition-colors"
          >
            Excel yuklab olish
          </button>
          <Link href="/shop/nasiyalar/import">
            <button className="h-9 px-4 text-sm border border-zinc-200 text-zinc-700 hover:bg-zinc-50 rounded transition-colors">
              + Eski nasiya kiritish
            </button>
          </Link>
          <Link href="/shop/nasiyalar/new">
            <button className="h-9 px-4 text-sm bg-zinc-900 hover:bg-zinc-800 text-white rounded transition-colors">
              + Yangi nasiya
            </button>
          </Link>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 border-b border-zinc-200">
        {filterTabs.map((tab) => (
          <button
            key={tab.value}
            onClick={() => { setActiveFilter(tab.value); setPage(1) }}
            className={`px-3 py-2 text-sm transition-colors border-b-2 -mb-px ${
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
              const isOverdue = n.isOverdue
              const canPay = (n.displayStatus === 'ACTIVE' || n.displayStatus === 'OVERDUE') && n.remainingAmount > 0
              return (
                <div
                  key={n.id}
                  className={`border border-zinc-200 rounded p-4 hover:bg-zinc-50 transition-colors ${
                    isOverdue ? 'border-l-2 border-l-red-500 pl-4' : ''
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <Link href={`/shop/nasiyalar/${n.id}`} prefetch={false} className="flex-1 min-w-0 block">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium text-sm text-zinc-900">{n.customer.name}</span>
                          <StatusBadge status={n.displayStatus} />
                          <PaymentScoreBadge score={n.paymentScore} />
                          {n.isImported && (
                            <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">
                              Eski nasiya
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-zinc-500 mb-2">
                          {n.device.model} · {formatUzPhoneDisplay(n.customer.phone)}
                          {n.nextPaymentDate && (
                            <> · Keyingi to'lov: {uzDate(n.nextPaymentDate)}</>
                          )}
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
                    </Link>

                    <div className="text-right flex-shrink-0 space-y-2">
                      <div>
                        <div className="text-sm font-bold text-zinc-900">{dfmt(n.contractRemainingAmount)}</div>
                        <div className="text-xs text-zinc-400 mt-0.5">qolgan</div>
                      </div>
                      {canPay && (
                        <button
                          type="button"
                          onClick={() => setPayFor(n)}
                          className="w-full rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 whitespace-nowrap"
                        >
                          To&apos;lov qabul qilish
                        </button>
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

          {/* Mobile card view — same key facts as the desktop list, actions
              (payment + Ko'rish) directly visible, not in an overflow menu. */}
          <div className="sm:hidden space-y-3">
            {nasiyalar.map((n) => {
              const dfmt = (amount: number) => formatDisplayMoneyFromContract(amount, n.contractCurrency, currency.currency, currency.usdUzsRate)
              const canPay = (n.displayStatus === 'ACTIVE' || n.displayStatus === 'OVERDUE') && n.remainingAmount > 0
              return (
                <div
                  key={n.id}
                  className={`border border-zinc-200 rounded p-3 space-y-2 ${n.isOverdue ? 'border-l-2 border-l-red-500' : ''}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-medium text-zinc-900">{n.customer.name}</div>
                      <div className="text-xs font-mono text-zinc-500 mt-0.5">{formatUzPhoneDisplay(n.customer.phone)}</div>
                    </div>
                    <StatusBadge status={n.displayStatus} />
                  </div>
                  <div className="text-xs text-zinc-500">{n.device.model}</div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <PaymentScoreBadge score={n.paymentScore} />
                    {n.isImported && (
                      <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">
                        Eski nasiya
                      </span>
                    )}
                    {n.isOverdue && (
                      <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">
                        Muddati o&apos;tgan
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between text-xs text-zinc-500">
                    <span>{n.nextPaymentDate ? `Keyingi to'lov: ${uzDate(n.nextPaymentDate)}` : '—'}</span>
                    <span className="font-bold text-sm text-zinc-900">{dfmt(n.contractRemainingAmount)} qolgan</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Link href={`/shop/nasiyalar/${n.id}`} prefetch={false} className="flex-1">
                      <Button variant="outline" className="h-8 w-full rounded border-zinc-200 text-xs">
                        Ko&apos;rish
                      </Button>
                    </Link>
                    {canPay && (
                      <button
                        type="button"
                        onClick={() => setPayFor(n)}
                        className="flex-1 rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 whitespace-nowrap"
                      >
                        To&apos;lov qabul qilish
                      </button>
                    )}
                  </div>
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
        <div className="flex items-center justify-between text-sm text-zinc-500">
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

      <NasiyaPaymentModal
        nasiyaId={payFor?.id ?? ''}
        open={payFor !== null}
        onOpenChange={(o) => { if (!o) setPayFor(null) }}
        customerName={payFor?.customer.name}
        deviceName={payFor?.device.model}
        onSuccess={handlePaymentSuccess}
      />
    </div>
  )
}
