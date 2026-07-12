'use client'

import { useMemo, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { actionLabel, actorLabel, formatLogValue, targetLabel } from '@/lib/log-format'
import { queryKeys } from '@/lib/query-keys'
import { useAuthenticatedQueryScope } from '@/components/query-scope-context'

type ActorType = 'SUPER_ADMIN' | 'SHOP_ADMIN'
type TabFilter = 'barchasi' | ActorType

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
  shop?: {
    id: string
    name: string
  } | null
}

interface ShopOption {
  id: string
  name: string
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

const tabs: { key: TabFilter; label: string }[] = [
  { key: 'barchasi', label: 'Barchasi' },
  { key: 'SUPER_ADMIN', label: 'Bosh admin' },
  { key: 'SHOP_ADMIN', label: "Do'kon" },
]

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

export default function LogsPage() {
  const scope = useAuthenticatedQueryScope()
  const [activeTab, setActiveTab] = useState<TabFilter>('barchasi')
  const [shopFilter, setShopFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [page, setPage] = useState(1)
  const perPage = 10

  const shopsQuery = useQuery({
    queryKey: queryKeys.domain(scope, 'adminShops'),
    queryFn: async ({ signal }) => {
      const response = await fetch('/api/shops', { signal, cache: 'no-store' })
      const json: ApiResponse<ShopOption[]> = await response.json()
      if (!response.ok || !json.success || !json.data) throw new Error(json.error || "Do'konlar yuklanmadi")
      return json.data
    },
  })

  const logsQuery = useQuery({
    queryKey: queryKeys.list(scope, 'adminLogs', { activeTab, shopFilter, dateFrom, dateTo, page, take: perPage }),
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams()
      if (activeTab !== 'barchasi') params.set('actorType', activeTab)
      if (shopFilter !== 'all') params.set('shopId', shopFilter)
      if (dateFrom) params.set('from', dateFrom)
      if (dateTo) params.set('to', dateTo)
      params.set('skip', String((page - 1) * perPage))
      params.set('take', String(perPage))

      const response = await fetch(`/api/logs?${params.toString()}`, { signal, cache: 'no-store' })
      const json: ApiResponse<LogsPayload> = await response.json()
      if (!response.ok || !json.success || !json.data) throw new Error(json.error ?? 'Loglar yuklanmadi')
      return json.data
    },
    placeholderData: keepPreviousData,
  })

  const shops = shopsQuery.data?.map(({ id, name }) => ({ id, name })) ?? []
  const logs = useMemo(() => (logsQuery.data?.logs ?? []).map((log) => ({
          id: log.id,
          datetime: formatDateTime(log.createdAt),
          actor: log.actorName || log.actorLogin || actorLabel(log.actorType),
          actorType: log.actorType,
          shop: log.shop?.name ?? '—',
          action: actionLabel(log.action, log.targetType),
          target: log.shop?.name ?? targetLabel(log.targetType, log.targetId, log.newValue),
          note: log.note || formatLogValue(log.newValue),
        })), [logsQuery.data?.logs])
  const totalLogs = logsQuery.data?.total ?? 0
  const loading = logsQuery.isPending && !logsQuery.data
  const error = logsQuery.error instanceof Error ? logsQuery.error.message : null

  const totalPages = Math.max(1, Math.ceil(totalLogs / perPage))
  const paginated = logs

  return (
    <div className="max-w-7xl mx-auto">
      <h1 className="text-xl font-semibold text-zinc-900 mb-6">Loglar</h1>

      {error && (
        <div className="mb-4 p-3 border border-red-200 bg-red-50 text-sm text-red-600">
          {error}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        {/* Type tabs */}
        <div className="flex items-center gap-0 border border-zinc-200">
          {tabs.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => { setActiveTab(key); setPage(1) }}
              className={[
                'px-3 py-1.5 text-xs font-medium transition-colors border-r border-zinc-200 last:border-r-0',
                activeTab === key
                  ? 'bg-zinc-900 text-white'
                  : 'bg-white text-zinc-500 hover:bg-zinc-50 hover:text-zinc-800',
              ].join(' ')}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Shop select */}
        <select
          value={shopFilter}
          onChange={(e) => { setShopFilter(e.target.value); setPage(1) }}
          className="h-8 text-xs border border-zinc-200 bg-white px-2 pr-6 focus:outline-none focus:ring-1 focus:ring-zinc-400 min-w-[160px]"
        >
          <option value="all">Barchasi</option>
          {shops.map((shop) => (
            <option key={shop.id} value={shop.id}>{shop.name}</option>
          ))}
        </select>

        {/* Date range */}
        <div className="flex items-center gap-2">
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => { setDateFrom(e.target.value); setPage(1) }}
            className="h-8 text-xs rounded-none border-zinc-200 w-36"
          />
          <span className="text-xs text-zinc-400">—</span>
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => { setDateTo(e.target.value); setPage(1) }}
            className="h-8 text-xs rounded-none border-zinc-200 w-36"
          />
        </div>

        <span className="ml-auto text-xs text-zinc-400">{totalLogs} ta yozuv</span>
      </div>

      {/* Table */}
      <div className="bg-white border border-zinc-200">
        <Table>
          <TableHeader>
            <TableRow className="border-zinc-200 bg-zinc-50">
              <TableHead className="text-xs text-zinc-500 font-medium pl-5 w-36">Sana / Vaqt</TableHead>
              <TableHead className="text-xs text-zinc-500 font-medium w-40">Kim</TableHead>
              <TableHead className="text-xs text-zinc-500 font-medium">Amal</TableHead>
              <TableHead className="text-xs text-zinc-500 font-medium">Nima haqida</TableHead>
              <TableHead className="text-xs text-zinc-500 font-medium pr-5">Eslatma</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-10 text-sm text-zinc-400">
                  Yuklanmoqda...
                </TableCell>
              </TableRow>
            ) : paginated.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-10 text-sm text-zinc-400">
                  Hech qanday log topilmadi
                </TableCell>
              </TableRow>
            ) : (
              paginated.map((log) => (
                <TableRow key={log.id} className="border-zinc-100 hover:bg-zinc-50">
                  <TableCell className="pl-5">
                    <span className="font-mono text-xs text-zinc-500">{log.datetime}</span>
                  </TableCell>
                  <TableCell>
                    <div>
                      <p className="text-xs font-bold text-zinc-800 leading-tight">{log.actor}</p>
                      <span className={[
                        'text-[10px] px-1.5 py-0.5 mt-0.5 inline-block',
                        log.actorType === 'SUPER_ADMIN'
                          ? 'bg-zinc-900 text-white'
                          : 'bg-zinc-100 text-zinc-500',
                      ].join(' ')}>
                        {log.actorType === 'SUPER_ADMIN' ? 'Bosh admin' : "Do'kon"}
                      </span>
                    </div>
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

      {/* Pagination */}
      <div className="flex items-center justify-between mt-4">
        <span className="text-xs text-zinc-400">
          {totalLogs} ta yozuvdan {totalLogs === 0 ? 0 : Math.min((page - 1) * perPage + 1, totalLogs)}-{Math.min(page * perPage, totalLogs)} ko&apos;rsatilmoqda
        </span>
        <div className="flex items-center gap-0 border border-zinc-200">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="h-8 px-4 text-xs border-r border-zinc-200 text-zinc-600 hover:bg-zinc-50 disabled:opacity-40 disabled:pointer-events-none transition-colors"
          >
            Oldingi
          </button>
          <span className="h-8 px-4 flex items-center text-xs text-zinc-500">
            {page} / {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="h-8 px-4 text-xs border-l border-zinc-200 text-zinc-600 hover:bg-zinc-50 disabled:opacity-40 disabled:pointer-events-none transition-colors"
          >
            Keyingi
          </button>
        </div>
      </div>
    </div>
  )
}
