'use client'

import { Fragment, useEffect, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { displayImei } from '@/lib/device-display'
import { useShopAccess } from '@/components/shop/shop-access-context'
import {
  HighlightedText,
  SearchEvidence,
  searchEvidenceFor,
  type SearchEvidenceCarrier,
} from '@/components/highlighted-text'

const PAGE_SIZE = 25
const SEARCH_DEBOUNCE_MS = 250

export interface InStockPickerDevice extends SearchEvidenceCarrier {
  id: string
  model: string
  color: string | null
  storage: string | null
  storageDisplay: string | null
  batteryHealth: number | null
  /** Present only for a shop owner; omitted by the server for staff. */
  purchasePrice?: number
  imei: string
  secondaryImei: string | null
  conditionLabel: string
  status: string
}

interface PageEnvelope {
  items: InStockPickerDevice[]
  total: number
  skip: number
  take: number
  matchEvidenceById?: unknown
}

interface ApiResponse<T> {
  success: boolean
  data: T
  error?: string
}

interface Props {
  purpose: 'sale' | 'nasiya'
  selectedDevice: InStockPickerDevice | null
  onSelect: (device: InStockPickerDevice) => void
  onDeepLinkSelect: (device: InStockPickerDevice) => void
  formatPrice: (price: number) => string
}

function DeviceMeta({ device, query }: { device: InStockPickerDevice; query: string }) {
  const fields = [
    { value: device.color, mode: 'text' as const },
    { value: device.storageDisplay || device.storage, mode: 'auto' as const },
    { value: device.batteryHealth != null ? `${device.batteryHealth}%` : null, mode: 'text' as const },
    { value: device.conditionLabel, mode: 'text' as const },
  ].filter((field) => field.value)

  return (
    <>
      {fields.map((field, index) => (
        <Fragment key={`${field.value}-${index}`}>
          {index > 0 && ' · '}
          <HighlightedText value={field.value} query={query} mode={field.mode} />
        </Fragment>
      ))}
      {fields.length > 0 && ' · '}
      IMEI: <HighlightedText value={displayImei(device.imei)} query={query} mode="identifier" />
      {device.secondaryImei && (
        <Fragment>
          {' · '}Qo‘shimcha IMEI: <HighlightedText value={displayImei(device.secondaryImei)} query={query} mode="identifier" />
        </Fragment>
      )}
    </>
  )
}

function normalizeDevice(device: InStockPickerDevice): InStockPickerDevice {
  const { purchasePrice, ...safeDevice } = device
  return {
    ...safeDevice,
    ...(purchasePrice != null ? { purchasePrice: Number(purchasePrice) } : {}),
  }
}

export function InStockDevicePicker({ purpose, selectedDevice, onSelect, onDeepLinkSelect, formatPrice }: Props) {
  const { memberKind } = useShopAccess()
  const canSeeOwnerFinancials = memberKind === 'SHOP_OWNER'
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [devices, setDevices] = useState<InStockPickerDevice[]>([])
  const [matchEvidenceById, setMatchEvidenceById] = useState<unknown>()
  const [resultQuery, setResultQuery] = useState('')
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const deepLinkHandler = useRef(onDeepLinkSelect)
  const loadMoreController = useRef<AbortController | null>(null)
  const queryTooShort = debouncedQuery.length === 1

  useEffect(() => {
    deepLinkHandler.current = onDeepLinkSelect
  }, [onDeepLinkSelect])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setLoadingMore(false)
      setDebouncedQuery(query.trim())
    }, SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [query])

  useEffect(() => {
    loadMoreController.current?.abort()
    if (debouncedQuery.length === 1) return

    const controller = new AbortController()

    async function loadFirstPage() {
      setLoading(true)
      setError('')
      try {
        const params = new URLSearchParams({
          status: 'IN_STOCK',
          view: 'picker',
          purpose,
          paginated: '1',
          skip: '0',
          take: String(PAGE_SIZE),
        })
        if (debouncedQuery) params.set('search', debouncedQuery)

        const response = await fetch(`/api/devices?${params}`, { signal: controller.signal })
        const json = (await response.json()) as ApiResponse<PageEnvelope>
        if (!response.ok || !json.success) throw new Error(json.error || 'Qurilmalarni yuklashda xatolik')

        setDevices(json.data.items.map(normalizeDevice))
        setTotal(json.data.total)
        setMatchEvidenceById(json.data.matchEvidenceById)
        setResultQuery(debouncedQuery)
      } catch (loadError) {
        if (controller.signal.aborted) return
        setDevices([])
        setTotal(0)
        setMatchEvidenceById(undefined)
        setResultQuery('')
        setError(loadError instanceof Error ? loadError.message : 'Xatolik yuz berdi')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }

    void loadFirstPage()
    return () => controller.abort()
  }, [debouncedQuery, purpose])

  // Device detail pages can deep-link straight into a sale flow. Fetch that
  // single row with a minimal picker projection; do not depend on it being in
  // the first inventory page.
  useEffect(() => {
    const deviceId = new URLSearchParams(window.location.search).get('deviceId')
    if (!deviceId) return

    const controller = new AbortController()
    void (async () => {
      try {
        const response = await fetch(`/api/devices/${encodeURIComponent(deviceId)}?view=picker&purpose=${purpose}`, {
          signal: controller.signal,
        })
        const json = (await response.json()) as ApiResponse<InStockPickerDevice>
        if (!response.ok || !json.success) throw new Error(json.error || 'Tanlangan qurilma topilmadi')
        if (json.data.status !== 'IN_STOCK') throw new Error('Tanlangan qurilma omborda mavjud emas')
        deepLinkHandler.current(normalizeDevice(json.data))
      } catch (loadError) {
        if (!controller.signal.aborted) {
          setError(loadError instanceof Error ? loadError.message : 'Tanlangan qurilma topilmadi')
        }
      }
    })()

    return () => controller.abort()
  }, [purpose])

  async function loadMore() {
    if (loadingMore || devices.length >= total) return
    loadMoreController.current?.abort()
    const controller = new AbortController()
    loadMoreController.current = controller
    setLoadingMore(true)
    setError('')
    try {
      const params = new URLSearchParams({
        status: 'IN_STOCK',
        view: 'picker',
        purpose,
        paginated: '1',
        skip: String(devices.length),
        take: String(PAGE_SIZE),
      })
      if (debouncedQuery) params.set('search', debouncedQuery)

      const response = await fetch(`/api/devices?${params}`, { signal: controller.signal })
      const json = (await response.json()) as ApiResponse<PageEnvelope>
      if (!response.ok || !json.success) throw new Error(json.error || 'Qurilmalarni yuklashda xatolik')

      setDevices((current) => {
        const knownIds = new Set(current.map((device) => device.id))
        return [...current, ...json.data.items.map(normalizeDevice).filter((device) => !knownIds.has(device.id))]
      })
      setMatchEvidenceById((current: unknown) => {
        const next = json.data.matchEvidenceById
        if (!current || typeof current !== 'object' || Array.isArray(current)) return next
        if (!next || typeof next !== 'object' || Array.isArray(next)) return current
        return { ...current, ...next }
      })
      setTotal(json.data.total)
    } catch (loadError) {
      if (controller.signal.aborted) return
      setError(loadError instanceof Error ? loadError.message : 'Xatolik yuz berdi')
    } finally {
      if (!controller.signal.aborted) setLoadingMore(false)
    }
  }

  return (
    <div className="space-y-3">
      <Input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Qurilmani qidiring (model, IMEI, rang)..."
        aria-label="Ombordagi qurilmalarni qidirish"
        className="h-9 rounded border-zinc-200 text-sm"
        autoFocus
      />

      {error && (
        <div role="alert" className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}

      <div className="overflow-hidden rounded border border-zinc-200" aria-busy={loading || loadingMore}>
        {loading ? (
          <div className="space-y-3 px-4 py-4" aria-label="Qurilmalar yuklanmoqda">
            {[0, 1, 2].map((row) => (
              <div key={row} className="h-11 animate-pulse rounded bg-zinc-100" />
            ))}
          </div>
        ) : queryTooShort ? (
          <div className="px-4 py-6 text-center text-sm text-zinc-400">Qidirish uchun kamida 2 ta belgi kiriting</div>
        ) : devices.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-zinc-400">Qurilma topilmadi</div>
        ) : (
          <>
            {devices.map((device, index) => {
              const isSelected = selectedDevice?.id === device.id
              const highlightQuery = !loading && query.trim() === resultQuery ? resultQuery : ''
              return (
                <button
                  key={device.id}
                  type="button"
                  onClick={() => onSelect(device)}
                  aria-pressed={isSelected}
                  className={`w-full cursor-pointer px-4 py-3 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-zinc-900 ${
                    isSelected ? 'bg-zinc-900/[0.03] ring-2 ring-inset ring-zinc-900' : 'hover:bg-zinc-50'
                  } ${index < devices.length - 1 ? 'border-b border-zinc-100' : ''}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <span
                        className={`flex size-5 shrink-0 items-center justify-center rounded-full border ${
                          isSelected ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-300'
                        }`}
                      >
                        {isSelected && <Check size={12} />}
                      </span>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-zinc-900"><HighlightedText value={device.model} query={highlightQuery} mode="text" /></div>
                        <div className="mt-0.5 truncate text-xs text-zinc-500"><DeviceMeta device={device} query={highlightQuery} /></div>
                        <SearchEvidence
                          evidence={searchEvidenceFor(device.id, device, { matchEvidenceById })}
                          query={highlightQuery}
                        />
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {isSelected && (
                        <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] font-medium text-white">
                          Tanlandi
                        </span>
                      )}
                      {canSeeOwnerFinancials && device.purchasePrice != null && (
                        <div className="text-sm font-bold text-zinc-900">{formatPrice(device.purchasePrice)}</div>
                      )}
                    </div>
                  </div>
                </button>
              )
            })}

            {devices.length < total && (
              <div className="border-t border-zinc-100 p-3">
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 w-full"
                  disabled={loadingMore}
                  onClick={() => void loadMore()}
                >
                  {loadingMore ? 'Yuklanmoqda...' : `Yana ko‘rsatish (${total - devices.length})`}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
