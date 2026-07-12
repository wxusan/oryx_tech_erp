'use client'

import { useEffect, useMemo, useState } from 'react'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { Input } from '@/components/ui/input'
import { DateInput } from '@/components/ui/date-input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { actionLabel, actorLabel, formatLogValue, targetLabel } from '@/lib/log-format'
import { logCategoryFor, logCategoryLabel, logCategoryOptions, type LogCategory } from '@/lib/log-categories'
import type { CurrencyContext } from '@/lib/currency'
import { replaceListUrlState } from '@/lib/list-url-state'
import { queryKeys } from '@/lib/query-keys'
import { useAuthenticatedQueryScope } from '@/components/query-scope-context'

type ActorType = 'SUPER_ADMIN' | 'SHOP_ADMIN'

interface LogEntry {
  id: string
  createdAt: string
  actorId: string
  actorType: ActorType
  action: string
  targetType: string
  targetId: string
  note: string | null
  newValue: unknown
  actorName?: string | null
  actorLogin?: string | null
}

interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
}

interface LogsPayload {
  logs: LogEntry[]
  total: number
}

// Item 8 — target types that MIGHT resolve to a shop-facing detail page.
// Customer/Shop/ShopAdmin/CurrencyRate/SuperAdmin/Database never do (no
// detail page exists), so those rows never attempt the link lookup at all.
const LINKABLE_TARGET_TYPES = new Set(['Device', 'Nasiya', 'NasiyaSchedule', 'Sale', 'SupplierPayable'])

interface DisplayLog {
  id: string
  datetime: string
  actor: string
  actorId: string
  actorType: ActorType
  category: LogCategory
  action: string
  target: string
  note: string
  targetType: string
  linkable: boolean
}

const PER_PAGE = 10

function formatDateTime(value: string) {
  return new Date(value).toLocaleString('ru-RU', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function displayLog(log: LogEntry, currency: CurrencyContext): DisplayLog {
  return {
    id: log.id,
    datetime: formatDateTime(log.createdAt),
    actor: log.actorName || log.actorLogin || actorLabel(log.actorType),
    actorId: log.actorId,
    actorType: log.actorType,
    category: logCategoryFor(log.action, log.targetType),
    action: actionLabel(log.action, log.targetType),
    target: targetLabel(log.targetType, log.targetId, log.newValue),
    note: log.note || formatLogValue(log.newValue, currency),
    targetType: log.targetType,
    linkable: LINKABLE_TARGET_TYPES.has(log.targetType),
  }
}

interface ShopLogsClientProps {
  initialPayload: LogsPayload
  initialRequestKey: string
  currency: CurrencyContext
  initialState: {
    search: string
    dateFrom: string
    dateTo: string
    category: LogCategory
    actorId: string
    page: number
  }
}

export default function ShopLogsClient({ initialPayload, initialRequestKey, currency, initialState }: ShopLogsClientProps) {
  const router = useRouter()
  const scope = useAuthenticatedQueryScope()
  const queryClient = useQueryClient()
  const [resolvingLogId, setResolvingLogId] = useState<string | null>(null)

  // Item 8 — clicking a log row opens the related sale/nasiya/device profile.
  // Resolved server-side (the log's targetId isn't always the URL id
  // directly — e.g. a nasiya payment log's targetId is the SCHEDULE's id).
  // A row with no possible link (Customer/Shop/account/etc.) never calls
  // this at all; a row whose target was deleted resolves to `href: null`
  // and simply does nothing rather than crashing or guessing a URL.
  async function openLogTarget(log: DisplayLog) {
    if (!log.linkable || resolvingLogId) return
    setResolvingLogId(log.id)
    try {
      const res = await fetch(`/api/logs/${log.id}/link`)
      const json: ApiResponse<{ href: string | null }> = await res.json()
      if (json.success && json.data?.href) {
        router.push(json.data.href)
      }
    } catch {
      // Silently no-op — a failed lookup must never crash the logs page.
    } finally {
      setResolvingLogId(null)
    }
  }
  const [search, setSearch] = useState(initialState.search)
  const [debouncedSearch, setDebouncedSearch] = useState(initialState.search)
  const [dateFrom, setDateFrom] = useState(initialState.dateFrom)
  const [dateTo, setDateTo] = useState(initialState.dateTo)
  const [category, setCategory] = useState<LogCategory>(initialState.category)
  const [actorId, setActorId] = useState(initialState.actorId)
  const [page, setPage] = useState(initialState.page)
  // Debounce the free-text search so typing doesn't fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  const requestKey = useMemo(() => {
    const params = new URLSearchParams()

    if (debouncedSearch.trim()) params.set('search', debouncedSearch.trim())
    if (category !== 'all') params.set('category', category)
    if (actorId) params.set('actorId', actorId)
    if (dateFrom) params.set('from', dateFrom)
    if (dateTo) params.set('to', dateTo)
    params.set('skip', String((page - 1) * PER_PAGE))
    params.set('take', String(PER_PAGE))

    return params.toString()
  }, [debouncedSearch, dateFrom, dateTo, category, actorId, page])

  useEffect(() => {
    replaceListUrlState({
      q: debouncedSearch,
      category,
      actorId,
      from: dateFrom,
      to: dateTo,
      page,
    })
  }, [actorId, category, dateFrom, dateTo, debouncedSearch, page])

  const logsQuery = useQuery({
    queryKey: queryKeys.list(scope, 'logs', {
      search: debouncedSearch,
      category,
      actorId,
      dateFrom,
      dateTo,
      page,
      take: PER_PAGE,
      sort: 'createdAt-desc',
    }),
    queryFn: async ({ signal }) => {
      const response = await fetch(`/api/logs?${requestKey}`, { signal, cache: 'no-store' })
      const json = await response.json() as ApiResponse<LogsPayload>
      if (!response.ok || !json.success || !json.data) throw new Error(json.error ?? 'Loglar yuklanmadi')
      return json.data
    },
    initialData: requestKey === initialRequestKey ? initialPayload : undefined,
    placeholderData: keepPreviousData,
  })

  const logs = useMemo(
    () => (logsQuery.data?.logs ?? []).map((log) => displayLog(log, currency)),
    [currency, logsQuery.data?.logs],
  )
  const totalLogs = logsQuery.data?.total ?? 0
  const currentLogsPayload = logsQuery.data
  const error = logsQuery.error instanceof Error ? logsQuery.error.message : null
  const loading = logsQuery.isPending && !logsQuery.data
  const knownActors = useMemo(() => {
    const map = new Map<string, string>()
    const cachedPages = queryClient.getQueriesData<LogsPayload>({ queryKey: queryKeys.domain(scope, 'logs') })
    const payloads = [
      initialPayload,
      ...(currentLogsPayload ? [currentLogsPayload] : []),
      ...cachedPages.flatMap(([, value]) => value ? [value] : []),
    ]
    for (const payload of payloads) {
      for (const log of payload.logs) {
        map.set(log.actorId, log.actorName || log.actorLogin || actorLabel(log.actorType))
      }
    }
    return map
  }, [currentLogsPayload, initialPayload, queryClient, scope])
  const totalPages = Math.max(1, Math.ceil(totalLogs / PER_PAGE))

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-zinc-900">Loglar</h1>
        <span className="text-xs text-zinc-400">{totalLogs} ta yozuv</span>
      </div>

      {error && (
        <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Input
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1) }}
          placeholder="Amal, eslatma yoki ID bo'yicha qidirish..."
          className="h-8 w-full rounded border-zinc-200 text-xs sm:w-72"
        />

        <div className="flex items-center gap-2">
          <DateInput
            value={dateFrom}
            onValueChange={(value) => { setDateFrom(value); setPage(1) }}
            className="h-8 w-36 rounded border-zinc-200 text-xs"
          />
          <span className="text-xs text-zinc-400">—</span>
          <DateInput
            value={dateTo}
            onValueChange={(value) => { setDateTo(value); setPage(1) }}
            className="h-8 w-36 rounded border-zinc-200 text-xs"
          />
        </div>

        {/* Item 1 — filter by admin. Options are real actors seen in the
            logs loaded so far (Log.actorId), never invented. */}
        <select
          value={actorId}
          onChange={(e) => { setActorId(e.target.value); setPage(1) }}
          className="h-8 rounded border border-zinc-200 bg-white px-2 text-xs text-zinc-700"
        >
          <option value="">Barcha adminlar</option>
          {[...knownActors.entries()].map(([id, name]) => (
            <option key={id} value={id}>{name}</option>
          ))}
        </select>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-zinc-200 pb-px">
        {logCategoryOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => { setCategory(option.value); setPage(1) }}
            className={[
              'shrink-0 border-b-2 px-3 py-2 text-xs font-medium transition-colors',
              category === option.value
                ? 'border-zinc-900 text-zinc-900'
                : 'border-transparent text-zinc-500 hover:text-zinc-800',
            ].join(' ')}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded border border-zinc-200 bg-white">
        <Table>
          <TableHeader>
            <TableRow className="border-zinc-200 bg-zinc-50">
              <TableHead className="w-36 pl-5 text-xs font-medium text-zinc-500">Sana / Vaqt</TableHead>
              <TableHead className="w-40 text-xs font-medium text-zinc-500">Kim</TableHead>
              <TableHead className="w-36 text-xs font-medium text-zinc-500">Kategoriya</TableHead>
              <TableHead className="text-xs font-medium text-zinc-500">Amal</TableHead>
              <TableHead className="text-xs font-medium text-zinc-500">Nima haqida</TableHead>
              <TableHead className="pr-5 text-xs font-medium text-zinc-500">Eslatma</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-sm text-zinc-400">
                  Yuklanmoqda...
                </TableCell>
              </TableRow>
            ) : logs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-sm text-zinc-400">
                  Log topilmadi
                </TableCell>
              </TableRow>
            ) : (
              logs.map((log) => (
                <TableRow
                  key={log.id}
                  onClick={() => openLogTarget(log)}
                  aria-disabled={!log.linkable}
                  className={[
                    'border-zinc-100 hover:bg-zinc-50',
                    log.linkable ? 'cursor-pointer' : '',
                    resolvingLogId === log.id ? 'opacity-60' : '',
                  ].join(' ')}
                >
                  <TableCell className="pl-5">
                    <span className="font-mono text-xs text-zinc-500">{log.datetime}</span>
                  </TableCell>
                  <TableCell>
                    <div>
                      <p className="text-xs font-bold leading-tight text-zinc-800">{log.actor}</p>
                      <span className={[
                        'mt-0.5 inline-block px-1.5 py-0.5 text-[10px]',
                        log.actorType === 'SUPER_ADMIN'
                          ? 'bg-zinc-900 text-white'
                          : 'bg-zinc-100 text-zinc-500',
                      ].join(' ')}>
                        {log.actorType === 'SUPER_ADMIN' ? 'Bosh admin' : "Do'kon"}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="rounded-md border-zinc-200 text-xs text-zinc-600">
                      {logCategoryLabel(log.category)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-zinc-700">{log.action}</TableCell>
                  <TableCell className="text-sm text-zinc-600">{log.target}</TableCell>
                  <TableCell className="pr-5 text-xs text-zinc-400">{log.note || '—'}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs text-zinc-400">
          {totalLogs} ta yozuvdan {totalLogs === 0 ? 0 : Math.min((page - 1) * PER_PAGE + 1, totalLogs)}-{Math.min(page * PER_PAGE, totalLogs)} ko&apos;rsatilmoqda
        </span>
        <div className="flex items-center gap-0 overflow-hidden rounded border border-zinc-200">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="h-8 border-r border-zinc-200 px-4 text-xs text-zinc-600 transition-colors hover:bg-zinc-50 disabled:pointer-events-none disabled:opacity-40"
          >
            Oldingi
          </button>
          <span className="flex h-8 items-center px-4 text-xs text-zinc-500">
            {page} / {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="h-8 border-l border-zinc-200 px-4 text-xs text-zinc-600 transition-colors hover:bg-zinc-50 disabled:pointer-events-none disabled:opacity-40"
          >
            Keyingi
          </button>
        </div>
      </div>
    </div>
  )
}
