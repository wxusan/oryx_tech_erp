'use client'

import { useCallback, useEffect, useState } from 'react'
import { Activity, AlertTriangle, Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { uzDateTime } from '@/lib/dates'
import type { ApiResponse } from '@/types'

interface OpsEvent {
  id: string
  level: 'INFO' | 'WARN' | 'ERROR'
  event: string
  message: string
  shopId: string | null
  status: string | null
  errorCode: string | null
  metadata: unknown
  createdAt: string
}

interface FailedNotification {
  id: string
  type: string
  status: string
  shopId: string | null
  attemptCount: number
  lastError: string | null
  lastAttemptAt: string | null
  createdAt: string
}

interface OpsPayload {
  windowDays: number
  levelCounts: Record<string, number>
  notificationCounts: Record<string, number>
  notificationWarnings: string[]
  events: OpsEvent[]
  recentFailedNotifications: FailedNotification[]
  lastCron: { event: string; message: string; metadata: unknown; createdAt: string } | null
  lastCronFailure: { event: string; message: string; metadata: unknown; createdAt: string } | null
  generatedAt: string
}

const levelStyles: Record<string, string> = {
  INFO: 'bg-zinc-100 text-zinc-600',
  WARN: 'bg-amber-100 text-amber-800',
  ERROR: 'bg-red-100 text-red-700',
}

function metaSummary(metadata: unknown) {
  if (!metadata || typeof metadata !== 'object') return ''
  return Object.entries(metadata as Record<string, unknown>)
    .slice(0, 6)
    .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(' · ')
}

export default function AdminOpsPage() {
  const [data, setData] = useState<OpsPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Only sets state inside async callbacks, so it is safe to run from an effect
  // (no synchronous setState in the effect body).
  const runFetch = useCallback(() => {
    return fetch('/api/admin/ops')
      .then(async (res) => {
        if (!res.ok) throw new Error('Yuklashda xatolik')
        const json: ApiResponse<OpsPayload> = await res.json()
        setData(json.data ?? null)
        setError('')
      })
      .catch((err: Error) => setError(err.message || 'Xatolik'))
      .finally(() => setLoading(false))
  }, [])

  const refresh = useCallback(() => {
    setLoading(true)
    setError('')
    void runFetch()
  }, [runFetch])

  useEffect(() => {
    void runFetch()
  }, [runFetch])

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <Activity className="size-5 text-zinc-500" />
            <h1 className="text-xl font-bold text-zinc-900">Tizim holati</h1>
          </div>
          <p className="text-sm text-zinc-500">
            Cron, bildirishnoma navbati va tizim xatoliklari{data ? ` · so'nggi ${data.windowDays} kun` : ''}
          </p>
        </div>
        <Button
          variant="outline"
          onClick={refresh}
          disabled={loading}
          className="h-9 w-fit rounded-md border-zinc-200 text-zinc-700"
        >
          {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          Yangilash
        </Button>
      </div>

      {error && (
        <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>
      )}

      {loading && !data ? (
        <div className="flex items-center gap-2 text-sm text-zinc-400">
          <Loader2 className="size-4 animate-spin" /> Yuklanmoqda...
        </div>
      ) : data ? (
        <>
          {data.notificationWarnings.length > 0 && (
            <div className="space-y-2">
              {data.notificationWarnings.map((warning) => (
                <div
                  key={warning}
                  className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
                >
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  <span>{warning}</span>
                </div>
              ))}
            </div>
          )}

          {/* Level + queue counts */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
            {(['INFO', 'WARN', 'ERROR'] as const).map((lvl) => (
              <Stat key={lvl} label={lvl} value={data.levelCounts[lvl] ?? 0} tone={lvl} />
            ))}
            {(['PENDING', 'PROCESSING', 'SENT', 'FAILED', 'CANCELLED'] as const).map((s) => (
              <Stat key={s} label={s} value={data.notificationCounts[s] ?? 0} />
            ))}
          </div>

          {/* Last cron run */}
          <div className="rounded-lg border border-zinc-200 bg-white p-4">
            <div className="mb-2 text-sm font-semibold text-zinc-900">Oxirgi cron</div>
            {data.lastCron ? (
              <div className="text-sm text-zinc-600">
                <span className="font-medium text-zinc-900">{data.lastCron.event}</span> ·{' '}
                {uzDateTime(data.lastCron.createdAt)}
                <div className="mt-1 text-xs text-zinc-500">{metaSummary(data.lastCron.metadata)}</div>
              </div>
            ) : (
              <div className="text-sm text-zinc-400">Cron hali ishlamagan (yozuv yo&apos;q)</div>
            )}
            {data.lastCronFailure && (
              <div className="mt-3 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <div>
                  Oxirgi xatolik: {uzDateTime(data.lastCronFailure.createdAt)} · {metaSummary(data.lastCronFailure.metadata)}
                </div>
              </div>
            )}
          </div>

          {/* Failed / cancelled notifications */}
          <Section title="Yuborilmagan bildirishnomalar">
            {data.recentFailedNotifications.length ? (
              <TableWrap head={['Turi', 'Holat', 'Urinish', 'Xatolik', 'Sana']}>
                {data.recentFailedNotifications.map((n) => (
                  <tr key={n.id} className="border-b border-zinc-100 last:border-0">
                    <td className="px-4 py-2.5 text-zinc-700">{n.type}</td>
                    <td className="px-4 py-2.5">
                      <span className={`rounded px-2 py-0.5 text-xs font-medium ${n.status === 'CANCELLED' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800'}`}>
                        {n.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-zinc-500">{n.attemptCount}</td>
                    <td className="max-w-xs truncate px-4 py-2.5 text-zinc-500" title={n.lastError ?? ''}>
                      {n.lastError ?? '—'}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-zinc-400">{uzDateTime(n.lastAttemptAt ?? n.createdAt)}</td>
                  </tr>
                ))}
              </TableWrap>
            ) : (
              <Empty>Yuborilmagan bildirishnoma yo&apos;q</Empty>
            )}
          </Section>

          {/* Recent ops events */}
          <Section title="So'nggi tizim hodisalari">
            {data.events.length ? (
              <TableWrap head={['Daraja', 'Hodisa', 'Xabar', 'Sana']}>
                {data.events.map((e) => (
                  <tr key={e.id} className="border-b border-zinc-100 last:border-0 align-top">
                    <td className="px-4 py-2.5">
                      <span className={`rounded px-2 py-0.5 text-xs font-medium ${levelStyles[e.level]}`}>{e.level}</span>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-zinc-700">{e.event}</td>
                    <td className="px-4 py-2.5 text-zinc-600">
                      {e.message}
                      {metaSummary(e.metadata) && (
                        <div className="mt-0.5 text-xs text-zinc-400">{metaSummary(e.metadata)}</div>
                      )}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-zinc-400">{uzDateTime(e.createdAt)}</td>
                  </tr>
                ))}
              </TableWrap>
            ) : (
              <Empty>Hodisalar yo&apos;q</Empty>
            )}
          </Section>
        </>
      ) : null}
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  const toneClass =
    tone === 'ERROR' && value > 0
      ? 'text-red-700'
      : tone === 'WARN' && value > 0
        ? 'text-amber-700'
        : 'text-zinc-900'
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={`mt-1 text-xl font-bold ${toneClass}`}>{value}</div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
      <div className="border-b border-zinc-200 bg-zinc-50 px-4 py-2.5 text-sm font-semibold text-zinc-900">
        {title}
      </div>
      {children}
    </div>
  )
}

function TableWrap({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="border-b border-zinc-200">
          <tr>
            {head.map((h) => (
              <th key={h} className="bg-zinc-50 px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-4 py-6 text-sm text-zinc-400">{children}</div>
}
