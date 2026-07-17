'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Activity, AlertTriangle, CheckCircle2, Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { uzDateTime } from '@/lib/dates'
import type { ApiResponse } from '@/types'
import { queryKeys } from '@/lib/query-keys'
import { useAuthenticatedQueryScope } from '@/components/query-scope-context'
import {
  INTERNAL_ERROR_MESSAGES,
  actorTypeLabel,
  exchangeRateSourceLabel,
  logActionLabel,
  logTargetLabel,
  internalErrorMessage,
  navigationDomainLabel,
  mutationCodeLabel,
  notificationCancellationLabel,
  notificationStatusLabel,
  notificationTypeLabel,
  operationsEventLabel,
  operationsLevelLabel,
  operationsStatusLabel,
  reminderPhaseLabel,
  shopFeatureLabel,
  shopPermissionLabel,
} from '@/lib/presentation-labels'

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
  alertWindow: {
    startsAt: string | null
    acknowledgedAt: string | null
  }
  levelCounts: Record<string, number>
  notificationCounts: Record<string, number>
  notificationWarnings: string[]
  queueHealth: {
    oldestActionableCreatedAt: string | null
    oldestActionableAgeSeconds: number
    oldestActionableStatus: string | null
  }
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
    .map(([k, v]) => `${k}=${metaValueLabel(k, v)}`)
    .join(' · ')
}

function metaValueLabel(key: string, value: unknown): string {
  if (value == null) return 'Ko‘rsatilmagan'
  if (typeof value === 'object') return JSON.stringify(value)
  if (typeof value !== 'string') return String(value)
  if (key === 'event') return operationsEventLabel(value)
  if (key === 'level') return operationsLevelLabel(value)
  if (key === 'status') {
    const notificationStatus = notificationStatusLabel(value)
    return notificationStatus === 'Holat noma’lum' ? operationsStatusLabel(value) : notificationStatus
  }
  if (key === 'type' || key === 'notificationType') return notificationTypeLabel(value)
  if (key === 'reason' || key === 'cancellationReason') return notificationCancellationLabel(value)
  if (key === 'source') return exchangeRateSourceLabel(value)
  if (key === 'actorType') return actorTypeLabel(value)
  if (key === 'targetType' || key === 'entityType') return logTargetLabel(value)
  if (key === 'action') return logActionLabel(value)
  if (key === 'permissionCode') return shopPermissionLabel(value)
  if (key === 'featureCode') return shopFeatureLabel(value)
  if (key === 'mutationCode' || key === 'mutationKind') return mutationCodeLabel(value)
  if (key === 'phase') return reminderPhaseLabel(value)
  if ((key === 'error' || key === 'errorCode') && value in INTERNAL_ERROR_MESSAGES) return internalErrorMessage(value)
  if (key === 'domain' || key === 'navigationDomain') return navigationDomainLabel(value)
  return value
}

function notificationErrorLabel(value: string | null) {
  if (!value) return '—'
  return [
    'legacy_recipient_unbound',
    'recipient_revoked_or_unverified',
    'recipient_not_entitled_or_notifications_disabled',
    'reminders_not_entitled',
    'invalid_reminder_reference',
    'debt_resolved_or_changed',
  ].reduce(
    (message, reason) => message.replaceAll(reason, notificationCancellationLabel(reason)),
    value,
  )
}

function queueAge(seconds: number) {
  if (seconds < 60) return `${seconds} soniya`
  if (seconds < 3_600) return `${Math.floor(seconds / 60)} daqiqa`
  return `${Math.floor(seconds / 3_600)} soat ${Math.floor((seconds % 3_600) / 60)} daqiqa`
}

export default function AdminOpsPage() {
  const scope = useAuthenticatedQueryScope()
  const [acknowledging, setAcknowledging] = useState(false)
  const [acknowledgeError, setAcknowledgeError] = useState('')
  const opsQuery = useQuery({
    queryKey: queryKeys.domain(scope, 'adminOps'),
    queryFn: async ({ signal }) => {
      const response = await fetch('/api/admin/ops', { signal, cache: 'no-store' })
      if (!response.ok) throw new Error('Yuklashda xatolik')
      const json: ApiResponse<OpsPayload> = await response.json()
      if (!json.success || !json.data) throw new Error(json.error || 'Xatolik')
      return json.data
    },
  })
  const data = opsQuery.data ?? null
  const loading = opsQuery.isPending || opsQuery.isFetching
  const error = opsQuery.error instanceof Error ? opsQuery.error.message : ''
  const refresh = () => { void opsQuery.refetch() }
  const acknowledgeResolvedAlerts = async () => {
    if (!window.confirm(
      "Joriy ogohlantirishlar hal qilinganini tasdiqlaysizmi? Oldingi hodisalar o'chirilmaydi; faqat yangi xatoliklar uchun kuzatuv davri boshlanadi.",
    )) return

    setAcknowledging(true)
    setAcknowledgeError('')
    try {
      const response = await fetch('/api/admin/ops/acknowledge', { method: 'POST' })
      const json: ApiResponse<{ acknowledgedAt: string }> = await response.json()
      if (!response.ok || !json.success) throw new Error(json.error || 'Ogohlantirishlarni tozalab bo\'lmadi')
      await opsQuery.refetch()
    } catch (acknowledgeErr) {
      setAcknowledgeError(acknowledgeErr instanceof Error ? acknowledgeErr.message : 'Ogohlantirishlarni tozalab bo\'lmadi')
    } finally {
      setAcknowledging(false)
    }
  }

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
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => { void acknowledgeResolvedAlerts() }}
            disabled={acknowledging || loading}
            className="h-9 w-fit rounded-md border-emerald-200 text-emerald-700 hover:bg-emerald-50"
          >
            {acknowledging ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
            Yangi kuzatuv davri
          </Button>
          <Button
            variant="outline"
            onClick={refresh}
            disabled={loading || acknowledging}
            className="h-9 w-fit rounded-md border-zinc-200 text-zinc-700"
          >
            {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            Yangilash
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>
      )}
      {acknowledgeError && (
        <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">{acknowledgeError}</div>
      )}

      {loading && !data ? (
        <div className="flex items-center gap-2 text-sm text-zinc-400">
          <Loader2 className="size-4 animate-spin" /> Yuklanmoqda...
        </div>
      ) : data ? (
        <>
          {data.alertWindow.startsAt && (
            <div className="flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
              <span>
                Yangi kuzatuv davri {uzDateTime(data.alertWindow.startsAt)} dan boshlandi. Oldingi hodisalar audit tarixida saqlangan.
              </span>
            </div>
          )}
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
              <Stat key={lvl} label={operationsLevelLabel(lvl)} value={data.levelCounts[lvl] ?? 0} tone={lvl} />
            ))}
            {(['PENDING', 'PROCESSING', 'SENT', 'FAILED', 'CANCELLED'] as const).map((s) => (
              <Stat key={s} label={notificationStatusLabel(s)} value={data.notificationCounts[s] ?? 0} />
            ))}
          </div>

          {/* Last cron run */}
          <div className="rounded-lg border border-zinc-200 bg-white p-4">
            <div className="mb-2 text-sm font-semibold text-zinc-900">Oxirgi cron</div>
            {data.lastCron ? (
              <div className="text-sm text-zinc-600">
                <span className="font-medium text-zinc-900">{operationsEventLabel(data.lastCron.event)}</span> ·{' '}
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
            <div className="mt-3 border-t border-zinc-100 pt-3 text-sm text-zinc-600">
              <span className="font-medium text-zinc-900">Navbat yoshi:</span>{' '}
              {data.queueHealth.oldestActionableCreatedAt ? (
                <>
                  {queueAge(data.queueHealth.oldestActionableAgeSeconds)} ·{' '}
                  {notificationStatusLabel(data.queueHealth.oldestActionableStatus)} ·{' '}
                  {uzDateTime(data.queueHealth.oldestActionableCreatedAt)}
                </>
              ) : (
                "hozir yuborilishi kerak bo'lgan navbat yo'q"
              )}
            </div>
          </div>

          {/* Failed / cancelled notifications */}
          <Section title="Yuborilmagan bildirishnomalar">
            {data.recentFailedNotifications.length ? (
              <TableWrap head={['Turi', 'Holat', 'Urinish', 'Xatolik', 'Sana']}>
                {data.recentFailedNotifications.map((n) => (
                  <tr key={n.id} className="border-b border-zinc-100 last:border-0">
                    <td className="px-4 py-2.5 text-zinc-700">{notificationTypeLabel(n.type)}</td>
                    <td className="px-4 py-2.5">
                      <span className={`rounded px-2 py-0.5 text-xs font-medium ${n.status === 'CANCELLED' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800'}`}>
                        {notificationStatusLabel(n.status)}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-zinc-500">{n.attemptCount}</td>
                    <td className="max-w-xs truncate px-4 py-2.5 text-zinc-500" title={notificationErrorLabel(n.lastError)}>
                      {notificationErrorLabel(n.lastError)}
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
                      <span className={`rounded px-2 py-0.5 text-xs font-medium ${levelStyles[e.level]}`}>{operationsLevelLabel(e.level)}</span>
                    </td>
                    <td className="px-4 py-2.5 text-xs font-medium text-zinc-700">{operationsEventLabel(e.event)}</td>
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
        : (tone === 'ERROR' || tone === 'WARN') && value === 0
          ? 'text-emerald-700'
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
