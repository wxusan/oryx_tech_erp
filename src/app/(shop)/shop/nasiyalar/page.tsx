'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

type NasiyaStatus = 'ACTIVE' | 'OVERDUE' | 'COMPLETED' | 'CANCELLED'
type DisplayStatus = 'Faol' | "Muddati o'tgan" | 'Yakunlangan' | 'Bekor qilingan'

interface NasiyaSchedule {
  id: string
  dueDate: string
  status: string
}

interface Nasiya {
  id: string
  totalAmount: number
  remainingAmount: number
  status: NasiyaStatus
  device: { model: string }
  customer: { name: string; phone: string }
  schedules: NasiyaSchedule[]
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

function fmt(n: number) {
  return Number(n).toLocaleString('ru-RU')
}

const UNPAID_STATUSES = ['PENDING', 'PARTIAL', 'OVERDUE', 'DEFERRED']

function getNextPayment(schedules: NasiyaSchedule[]): NasiyaSchedule | null {
  const pending = schedules
    .filter((s) => UNPAID_STATUSES.includes(s.status))
    .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())
  return pending[0] ?? null
}

export default function NasiyalarPage() {
  const [nasiyalar, setNasiyalar] = useState<Nasiya[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeFilter, setActiveFilter] = useState<NasiyaStatus | 'Barchasi'>('Barchasi')

  useEffect(() => {
    fetch('/api/nasiya')
      .then((r) => r.json())
      .then((json) => {
        if (json.success) setNasiyalar(json.data)
        else setError(json.error || 'Xatolik yuz berdi')
      })
      .catch(() => setError('Xatolik yuz berdi'))
      .finally(() => setLoading(false))
  }, [])

  const filtered = nasiyalar.filter(
    (n) => activeFilter === 'Barchasi' || n.status === activeFilter
  )

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-zinc-900">Nasiyalar</h1>
          <p className="text-sm text-zinc-500 mt-0.5">Barcha nasiya shartnomalar</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { window.location.href = '/api/export/nasiya?format=xlsx' }}
            className="h-9 px-4 text-sm bg-zinc-900 hover:bg-zinc-800 text-white rounded transition-colors"
          >
            Excel yuklab olish
          </button>
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
            onClick={() => setActiveFilter(tab.value)}
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

      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-4 py-3">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-zinc-400 py-8 text-center">Yuklanmoqda...</div>
      ) : (
        /* List */
        <div className="space-y-2">
          {filtered.map((n) => {
            const paidAmount = n.totalAmount - n.remainingAmount
            const pct = n.totalAmount > 0 ? Math.round((paidAmount / n.totalAmount) * 100) : 0
            const isOverdue = n.status === 'OVERDUE'
            const nextPayment = getNextPayment(n.schedules ?? [])
            return (
              <Link key={n.id} href={`/shop/nasiyalar/${n.id}`} className="block">
                <div
                  className={`border border-zinc-200 rounded p-4 hover:bg-zinc-50 transition-colors ${
                    isOverdue ? 'border-l-2 border-l-red-500 pl-4' : ''
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-sm text-zinc-900">{n.customer.name}</span>
                        <StatusBadge status={n.status} />
                      </div>
                      <div className="text-xs text-zinc-500 mb-2">
                        {n.device.model} · {n.customer.phone}
                        {nextPayment && (
                          <> · Keyingi to'lov: {new Date(nextPayment.dueDate).toLocaleDateString('uz-UZ')}</>
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
                        <span>To'langan: {fmt(paidAmount)} so'm</span>
                        <span>·</span>
                        <span>Jami: {fmt(n.totalAmount)} so'm</span>
                      </div>
                    </div>

                    <div className="text-right flex-shrink-0">
                      <div className="text-sm font-bold text-zinc-900">{fmt(n.remainingAmount)} so'm</div>
                      <div className="text-xs text-zinc-400 mt-0.5">qolgan</div>
                    </div>
                  </div>
                </div>
              </Link>
            )
          })}
          {filtered.length === 0 && (
            <div className="text-center py-12 text-zinc-400 text-sm">Nasiya topilmadi</div>
          )}
        </div>
      )}
    </div>
  )
}
