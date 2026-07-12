'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'
import { formatMoneyByCurrency, type CurrencyContext } from '@/lib/currency'
import { FINANCIAL_DATA_CHANGED_EVENT } from '@/lib/client-events'

const FALLBACK_REFRESH_MS = 5 * 60_000

interface DueOverdueSummary {
  overdueDealCount: number
  overdueMoneyUzs: number
  currency: CurrencyContext
  singleDeal: { type: 'nasiya' | 'sale'; id: string } | null
}

/**
 * Item 10 — persistent, shop-wide banner for overdue nasiya/sale debt.
 * Shown in the layout (every shop page, not just the dashboard), so it
 * can't be missed. Deliberately has NO dismiss button — "persistent until
 * paid" per the ticket — it simply stops rendering itself once the shop's
 * overdue count drops to 0 (checked on every mount/navigation via the
 * layout's client-side fetch). No spam: one summarized banner, not one per
 * overdue deal, and a direct link only when there is exactly one deal.
 */
export function DueOverdueBanner() {
  const [summary, setSummary] = useState<DueOverdueSummary | null>(null)

  useEffect(() => {
    let ignore = false
    let activeController: AbortController | null = null
    function load() {
      activeController?.abort()
      activeController = new AbortController()
      fetch('/api/stats/due-overdue', { signal: activeController.signal })
        .then((res) => res.json())
        .then((json) => {
          if (!ignore && json.success) setSummary(json.data)
        })
        .catch(() => {})
    }
    load()
    // Refresh immediately after local money mutations and when the user
    // returns to the app. The five-minute interval is only a safety net for
    // changes made in another tab/device, replacing the old 60-second poll.
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') load()
    }
    const interval = window.setInterval(refreshWhenVisible, FALLBACK_REFRESH_MS)
    window.addEventListener('focus', refreshWhenVisible)
    window.addEventListener('online', refreshWhenVisible)
    window.addEventListener(FINANCIAL_DATA_CHANGED_EVENT, load)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => {
      ignore = true
      activeController?.abort()
      window.clearInterval(interval)
      window.removeEventListener('focus', refreshWhenVisible)
      window.removeEventListener('online', refreshWhenVisible)
      window.removeEventListener(FINANCIAL_DATA_CHANGED_EVENT, load)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [])

  if (!summary || summary.overdueDealCount === 0) return null

  const amountText = formatMoneyByCurrency(summary.overdueMoneyUzs, summary.currency.currency, summary.currency.usdUzsRate)
  const href = summary.singleDeal
    ? summary.singleDeal.type === 'nasiya'
      ? `/shop/nasiyalar/${summary.singleDeal.id}`
      : `/shop/qurilmalar` // Sale detail lives on the device page; no standalone sale route today.
    : '/shop/nasiyalar?status=OVERDUE'

  return (
    <Link
      href={href}
      className="flex items-center gap-2 border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-800 hover:bg-red-100 sm:text-sm"
    >
      <AlertTriangle size={14} className="flex-shrink-0" />
      <span className="min-w-0 flex-1 truncate">
        {summary.overdueDealCount === 1
          ? `1 ta mijozning to'lovi muddati o'tgan — ${amountText}`
          : `${summary.overdueDealCount} ta mijozning to'lovi muddati o'tgan — jami ${amountText}`}
      </span>
      <span className="flex-shrink-0 underline">Ko&apos;rish</span>
    </Link>
  )
}
