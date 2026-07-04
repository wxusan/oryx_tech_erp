'use client'

import { useEffect, useMemo, useState } from 'react'
import { Input } from '@/components/ui/input'
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

interface DisplayLog {
  id: string
  datetime: string
  actor: string
  actorType: ActorType
  category: LogCategory
  action: string
  target: string
  note: string
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
    actorType: log.actorType,
    category: logCategoryFor(log.action, log.targetType),
    action: actionLabel(log.action, log.targetType),
    target: targetLabel(log.targetType, log.targetId, log.newValue),
    note: log.note || formatLogValue(log.newValue, currency),
  }
}

interface ShopLogsClientProps {
  initialPayload: LogsPayload
  initialRequestKey: string
  currency: CurrencyContext
}

export default function ShopLogsClient({ initialPayload, initialRequestKey, currency }: ShopLogsClientProps) {
  const [logs, setLogs] = useState<DisplayLog[]>(() => initialPayload.logs.map((log) => displayLog(log, currency)))
  const [loadedKey, setLoadedKey] = useState(initialRequestKey)
  const [error, setError] = useState<string | null>(null)
  const [totalLogs, setTotalLogs] = useState(initialPayload.total)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [category, setCategory] = useState<LogCategory>('all')
  const [page, setPage] = useState(1)

  // Debounce the free-text search so typing doesn't fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  const requestKey = useMemo(() => {
    const params = new URLSearchParams()

    if (debouncedSearch.trim()) params.set('search', debouncedSearch.trim())
    if (category !== 'all') params.set('category', category)
    if (dateFrom) params.set('from', dateFrom)
    if (dateTo) params.set('to', dateTo)
    params.set('skip', String((page - 1) * PER_PAGE))
    params.set('take', String(PER_PAGE))

    return params.toString()
  }, [debouncedSearch, dateFrom, dateTo, category, page])

  useEffect(() => {
    if (loadedKey === requestKey) return

    const controller = new AbortController()

    fetch(`/api/logs?${requestKey}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((json: ApiResponse<LogsPayload>) => {
        if (!json.success || !json.data) {
          setError(json.error ?? 'Loglar yuklanmadi')
          setLogs([])
          setTotalLogs(0)
          setLoadedKey(requestKey)
          return
        }

        setError(null)
        setTotalLogs(json.data.total)
        setLogs(json.data.logs.map((log) => displayLog(log, currency)))
        setLoadedKey(requestKey)
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return
        setError('Xatolik yuz berdi')
        setLogs([])
        setTotalLogs(0)
        setLoadedKey(requestKey)
      })

    return () => controller.abort()
  }, [currency, loadedKey, requestKey])

  const loading = loadedKey !== requestKey
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
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => { setDateFrom(e.target.value); setPage(1) }}
            className="h-8 w-36 rounded border-zinc-200 text-xs"
          />
          <span className="text-xs text-zinc-400">—</span>
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => { setDateTo(e.target.value); setPage(1) }}
            className="h-8 w-36 rounded border-zinc-200 text-xs"
          />
        </div>
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
                <TableRow key={log.id} className="border-zinc-100 hover:bg-zinc-50">
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
