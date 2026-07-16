'use client'

import { useEffect, useRef } from 'react'
import { Loader2, RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { markQuerySettled } from '@/lib/client-performance'

interface QueryActivityProps {
  children: React.ReactNode
  isFetching: boolean
  isInitialLoading?: boolean
  error?: string | null
  onRetry?: () => void
  label?: string
  metricId?: string
  className?: string
}

/**
 * Keeps existing results mounted while a query refreshes and exposes the
 * background work to both sighted and assistive-technology users.
 */
export function QueryActivity({
  children,
  isFetching,
  isInitialLoading = false,
  error,
  onRetry,
  label = 'Ma’lumotlar yangilanmoqda',
  metricId,
  className,
}: QueryActivityProps) {
  const wasFetching = useRef(false)

  useEffect(() => {
    if (wasFetching.current && !isFetching && metricId) markQuerySettled(metricId)
    wasFetching.current = isFetching
  }, [isFetching, metricId])

  const showBackgroundActivity = isFetching && !isInitialLoading

  return (
    <section
      className={cn('relative', className)}
      aria-busy={isFetching}
      data-query-activity=""
    >
      <div className="h-1 overflow-hidden" aria-hidden="true">
        <div
          className={cn(
            'h-full origin-left bg-zinc-900 transition-opacity',
            showBackgroundActivity ? 'animate-pulse opacity-100' : 'opacity-0',
          )}
        />
      </div>
      <div
        className="flex min-h-7 items-center justify-between gap-3 px-1 text-xs text-zinc-500"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        <span className={cn('inline-flex items-center gap-1.5', !showBackgroundActivity && 'invisible')}>
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          {label}
        </span>
        {error && onRetry && (
          <Button type="button" size="xs" variant="outline" onClick={onRetry}>
            <RotateCw className="size-3" aria-hidden="true" /> Qayta urinish
          </Button>
        )}
      </div>
      {error && (
        <div role="alert" className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {children}
    </section>
  )
}
