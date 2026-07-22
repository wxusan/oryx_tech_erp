'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'
import { IntentPrefetchLink } from '@/components/intent-prefetch-link'
import { QueryActivity } from '@/components/query-activity'
import { Button } from '@/components/ui/button'
import { formatMoneyByCurrency } from '@/lib/currency'
import { uzDate } from '@/lib/dates'
import { historyStatusLabel, paymentMethodLabel } from '@/lib/labels'
import type { CustomerProfileHistory, CustomerProfileHistoryItem, CustomerProfileSection } from '@/lib/server/customer-profile'
import { cn } from '@/lib/utils'

const SECTION_LABELS: Record<CustomerProfileSection, string> = {
  devices: 'Qurilmalar',
  sales: 'Sotuvlar',
  nasiya: 'Nasiyalar',
  payments: "To'lovlar",
  returns: 'Qaytarishlar',
  resolutions: 'Yopish / arxiv',
}

function historyAmount(item: CustomerProfileHistoryItem) {
  if (item.amount == null || !item.currency) return 'Aniq summa mavjud emas'
  return formatMoneyByCurrency(item.amount, item.currency, null)
}

function historyHref(item: CustomerProfileHistoryItem) {
  if (!item.referenceId) return null
  if (item.kind === 'nasiya' || item.kind === 'nasiya-payment' || item.kind === 'resolution' || item.kind === 'settlement') {
    return `/shop/nasiyalar/${item.referenceId}`
  }
  if (item.kind === 'device' || item.kind === 'sale' || item.kind === 'sale-payment' || item.kind === 'return') {
    return `/shop/qurilmalar/${item.referenceId}`
  }
  return null
}

export function CustomerProfileHistorySection({
  history,
  section,
  page,
  canSeeOwnerFinancials,
  isFetching,
  error,
  onSectionChange,
  onPageChange,
  onRetry,
}: {
  history: CustomerProfileHistory
  section: CustomerProfileSection
  page: number
  canSeeOwnerFinancials: boolean
  isFetching: boolean
  error: string | null
  onSectionChange: (section: CustomerProfileSection) => void
  onPageChange: (page: number) => void
  onRetry: () => void
}) {
  return (
    <section aria-labelledby="customer-history-title" className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
      <div className="border-b border-zinc-200 p-4 sm:p-5">
        <h2 id="customer-history-title" className="text-sm font-semibold text-zinc-950">Mijoz tarixi</h2>
        <div role="tablist" aria-label="Mijoz tarixi bo'limlari" className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {(Object.keys(SECTION_LABELS) as CustomerProfileSection[])
            .filter((candidate) => canSeeOwnerFinancials || candidate !== 'resolutions')
            .map((candidate) => (
              <button
                key={candidate}
                type="button"
                role="tab"
                aria-selected={candidate === section}
                onClick={() => onSectionChange(candidate)}
                className={cn(
                  'min-h-9 shrink-0 rounded-md px-3 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900',
                  candidate === section ? 'bg-zinc-950 text-white' : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200',
                )}
              >
                {SECTION_LABELS[candidate]}
              </button>
            ))}
        </div>
      </div>

      <QueryActivity
        isFetching={isFetching}
        error={error}
        onRetry={onRetry}
        label="Mijoz tarixi yangilanmoqda"
        metricId="customer-profile-history"
        className="px-1"
      >
        {history.items.length === 0 ? (
          <p className="p-8 text-center text-sm text-zinc-500">Bu bo‘limda ma’lumot yo‘q</p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {history.items.map((item) => {
              const itemHref = historyHref(item)
              const content = (
                <>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-zinc-950">
                      {item.kind === 'resolution' || item.kind === 'settlement' ? historyStatusLabel(item.title) : item.title}
                    </p>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      {item.subtitle
                        ? item.kind.endsWith('payment') ? paymentMethodLabel(item.subtitle) : item.subtitle
                        : historyStatusLabel(item.status)} · {uzDate(item.occurredAt)}
                    </p>
                  </div>
                  <div className="shrink-0 text-left sm:text-right">
                    <p className="text-sm font-semibold text-zinc-800">{historyAmount(item)}</p>
                    {item.status && <p className="mt-0.5 text-[11px] text-zinc-500">{historyStatusLabel(item.status)}</p>}
                  </div>
                </>
              )

              return (
                <li key={item.id}>
                  {itemHref ? (
                    <IntentPrefetchLink
                      href={itemHref}
                      className="flex flex-col gap-2 p-4 transition-colors hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-zinc-900 sm:flex-row sm:items-center sm:justify-between"
                    >
                      {content}
                    </IntentPrefetchLink>
                  ) : (
                    <div className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">{content}</div>
                  )}
                </li>
              )
            })}
          </ul>
        )}

        {(page > 1 || history.hasNext) && (
          <div className="flex items-center justify-between border-t border-zinc-200 p-4">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={page <= 1 || isFetching}
              onClick={() => onPageChange(Math.max(1, page - 1))}
            >
              <ChevronLeft className="mr-1 size-4" aria-hidden="true" /> Oldingi
            </Button>
            <span className="text-xs text-zinc-500">{page}-sahifa</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!history.hasNext || isFetching}
              onClick={() => onPageChange(page + 1)}
            >
              Keyingi <ChevronRight className="ml-1 size-4" aria-hidden="true" />
            </Button>
          </div>
        )}
      </QueryActivity>
    </section>
  )
}
