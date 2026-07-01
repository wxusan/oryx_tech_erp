'use client'

import { useEffect, useState } from 'react'

interface ShopStats {
  cashReceivedThisMonth: number
  expectedThisMonth: number
  overdueMoney: number
  inventoryPurchaseCost: number
  realProfitThisMonth: number
}

function fmt(value: number) {
  return Number(value).toLocaleString('ru-RU') + " so'm"
}

export default function ShopReportPage() {
  const [stats, setStats] = useState<ShopStats | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/stats/shop')
      .then((res) => res.json())
      .then((json) => {
        if (json.success) setStats(json.data)
        else setError(json.error || 'Hisobot yuklanmadi')
      })
      .catch(() => setError('Hisobot yuklanmadi'))
  }, [])

  const rows = stats
    ? [
        ['Bu oy kelgan pul', fmt(stats.cashReceivedThisMonth)],
        ['Bu oy kutilayotgan pul', fmt(stats.expectedThisMonth)],
        ["Muddati o'tgan qarz", fmt(stats.overdueMoney)],
        ['Ombor tannarxi', fmt(stats.inventoryPurchaseCost)],
        ['Sof foyda', fmt(stats.realProfitThisMonth)],
      ]
    : []

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-xl font-bold text-zinc-900">Hisobot</h1>
      {error && <div className="text-sm text-red-600 border border-red-200 bg-red-50 rounded px-4 py-3">{error}</div>}
      <div className="border border-zinc-200 rounded overflow-hidden max-w-2xl">
        {stats ? (
          rows.map(([label, value]) => (
            <div key={label} className="flex items-center justify-between border-b border-zinc-100 last:border-0 px-4 py-3">
              <span className="text-sm text-zinc-500">{label}</span>
              <span className="text-sm font-semibold text-zinc-900">{value}</span>
            </div>
          ))
        ) : (
          <div className="px-4 py-8 text-sm text-zinc-400">Yuklanmoqda...</div>
        )}
      </div>
    </div>
  )
}
