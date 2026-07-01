'use client'

import { useState, useEffect } from 'react'

interface UpcomingPayment {
  nasiya: {
    customer: { name: string }
    device: { model: string }
  }
  dueDate: string
  expectedAmount: number
}

interface RecentActivity {
  action: string
  createdAt: string
  actorId: string
}

interface ShopStats {
  totalDevices: number
  soldThisMonth: number
  activeNasiyalar: number
  expectedThisMonth: number
  overdueCount: number
  upcomingPayments: UpcomingPayment[]
  recentActivity: RecentActivity[]
}

function fmt(n: number) {
  return Number(n).toLocaleString('ru-RU') + " so'm"
}

export default function DashboardPage() {
  const [stats, setStats] = useState<ShopStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/stats/shop')
      .then((r) => r.json())
      .then((json) => {
        if (json.success) setStats(json.data)
        else setError(json.error || 'Xatolik yuz berdi')
      })
      .catch(() => setError('Xatolik yuz berdi'))
      .finally(() => setLoading(false))
  }, [])

  const statCards = stats
    ? [
        { label: 'Jami qurilmalar', value: String(stats.totalDevices) },
        { label: 'Sotilgan bu oy', value: String(stats.soldThisMonth) },
        { label: 'Faol nasiyalar', value: String(stats.activeNasiyalar) },
        { label: "Bu oy kutilgan to'lov", value: fmt(stats.expectedThisMonth) },
        { label: "Muddati o'tgan", value: String(stats.overdueCount) },
      ]
    : []

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-zinc-900">Boshqaruv paneli</h1>
        <p className="text-sm text-zinc-500 mt-0.5">Umumiy holat</p>
      </div>

      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-4 py-3">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-zinc-400">Yuklanmoqda...</div>
      ) : (
        <>
          {/* Stats grid */}
          <div className="grid grid-cols-3 gap-4">
            {statCards.map((s) => (
              <div key={s.label} className="bg-white border border-zinc-200 p-4 rounded">
                <div className="text-xs text-zinc-500 mb-1">{s.label}</div>
                <div className="text-2xl font-bold text-zinc-900">{s.value}</div>
              </div>
            ))}
          </div>

          {/* Two col */}
          <div className="grid grid-cols-2 gap-4">
            {/* Upcoming payments */}
            <div className="border border-zinc-200 rounded p-4">
              <div className="font-semibold text-sm text-zinc-900 mb-3">Yaqin to'lov sanalari</div>
              <div className="space-y-2">
                {stats?.upcomingPayments && stats.upcomingPayments.length > 0 ? (
                  stats.upcomingPayments.map((p, i) => (
                    <div key={i} className="flex items-center justify-between py-2 border-b border-zinc-100 last:border-0">
                      <div>
                        <div className="text-sm font-medium text-zinc-900">{p.nasiya.customer.name}</div>
                        <div className="text-xs text-zinc-500">
                          {p.nasiya.device.model} · {new Date(p.dueDate).toLocaleDateString('uz-UZ')}
                        </div>
                      </div>
                      <div className="text-sm font-semibold text-zinc-900">{fmt(p.expectedAmount)}</div>
                    </div>
                  ))
                ) : (
                  <div className="text-sm text-zinc-400 py-4 text-center">To'lovlar yo'q</div>
                )}
              </div>
            </div>

            {/* Recent actions */}
            <div className="border border-zinc-200 rounded p-4">
              <div className="font-semibold text-sm text-zinc-900 mb-3">Oxirgi operatsiyalar</div>
              <div className="space-y-2">
                {stats?.recentActivity && stats.recentActivity.length > 0 ? (
                  stats.recentActivity.map((a, i) => (
                    <div key={i} className="flex items-center justify-between py-2 border-b border-zinc-100 last:border-0">
                      <div className="text-sm text-zinc-700">{a.action}</div>
                      <div className="text-xs text-zinc-400 ml-4 whitespace-nowrap">
                        {new Date(a.createdAt).toLocaleDateString('uz-UZ')}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-sm text-zinc-400 py-4 text-center">Operatsiyalar yo'q</div>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
