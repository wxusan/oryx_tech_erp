'use client'

import Link from 'next/link'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react'
import { useAuthenticatedQueryScope } from '@/components/query-scope-context'
import { queryKeys } from '@/lib/query-keys'
import { buttonVariants } from '@/components/ui/button'
import { TrustBadge, type TrustBadgeData } from '@/components/shop/trust-badge'
import { CustomerPassportPanel } from '@/components/shop/customer-passport-panel'
import { formatUzPhoneDisplay } from '@/lib/phone'
import { uzDate } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { historyStatusLabel, paymentMethodLabel } from '@/lib/labels'
import type { CustomerProfileSection } from '@/lib/server/customer-profile'

const SECTION_LABELS: Record<CustomerProfileSection, string> = {
  devices: 'Qurilmalar',
  sales: 'Sotuvlar',
  nasiya: 'Nasiyalar',
  payments: "To'lovlar",
  returns: 'Qaytarishlar',
  resolutions: 'Arxiv / hisobdan chiqarish',
}

interface ProfileResponse {
  success: boolean
  data?: {
    overview: {
      customer: {
        id: string
        name: string
        phone: string
        additionalPhones: string[]
        note: string | null
        createdAt: string
        passportMasked: string | null
        hasPassportPhoto: boolean
      }
      trust: TrustBadgeData & { reasons: string[]; factors: { onTimeRatio: number | null; lateInstallmentCount: number; maxDaysLate: number } }
      metrics: {
        contractValue: NativeMoney
        cashCollected: NativeMoney
        dueToday: NativeMoney
        overdue: NativeMoney
        refunds: NativeMoney
        writeOffs: NativeMoney
        accountingAccrualGrossProfitUzs: number
        nasiyaInterestUzs: number
        legacyUsdPaymentCount: number
      }
      counts: Record<string, number>
    }
    section: CustomerProfileSection
    history: { items: HistoryItem[]; total: number; page: number; take: number }
  }
  error?: string
}

interface NativeMoney { UZS: number; USD: number }
interface HistoryItem {
  id: string
  occurredAt: string
  kind: string
  referenceId: string | null
  title: string
  subtitle: string | null
  currency: 'UZS' | 'USD' | null
  amount: number | null
  status: string | null
}

function nativeMoney(value: NativeMoney) {
  const parts: string[] = []
  if (value.UZS !== 0) parts.push(`${Math.round(value.UZS).toLocaleString('ru-RU')} UZS`)
  if (value.USD !== 0) parts.push(`$${value.USD.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
  return parts.length ? parts.join(' · ') : '0'
}

function historyAmount(item: HistoryItem) {
  if (item.amount == null || !item.currency) return 'Aniq summa mavjud emas'
  return nativeMoney({ UZS: item.currency === 'UZS' ? item.amount : 0, USD: item.currency === 'USD' ? item.amount : 0 })
}

function historyHref(item: HistoryItem) {
  if (!item.referenceId) return null
  if (item.kind === 'nasiya' || item.kind === 'nasiya-payment' || item.kind === 'resolution') {
    return `/shop/nasiyalar/${item.referenceId}`
  }
  if (item.kind === 'device' || item.kind === 'sale' || item.kind === 'sale-payment' || item.kind === 'return') {
    return `/shop/qurilmalar/${item.referenceId}`
  }
  return null
}

export function CustomerProfileClient({
  customerId,
  initialSection,
  initialPage,
}: {
  customerId: string
  initialSection: CustomerProfileSection
  initialPage: number
}) {
  const scope = useAuthenticatedQueryScope()
  const section = initialSection
  const page = initialPage
  const query = useQuery({
    queryKey: queryKeys.list(scope, 'customers', { surface: 'profile', customerId, section, page, take: 20 }),
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ section, page: String(page) })
      const response = await fetch(`/api/customers/${customerId}/profile?${params}`, { signal, cache: 'no-store' })
      const json = await response.json() as ProfileResponse
      if (!response.ok || !json.success || !json.data) throw new Error(json.error || "Mijoz profilini yuklab bo'lmadi")
      return json.data
    },
    placeholderData: keepPreviousData,
  })

  function href(nextSection: CustomerProfileSection, nextPage = 1) {
    return `/shop/mijozlar/${customerId}?section=${nextSection}&page=${nextPage}`
  }

  if (query.isPending && !query.data) {
    return <div className="p-6" role="status">Mijoz profili yuklanmoqda…</div>
  }
  if (query.isError || !query.data) {
    return <div className="p-6"><p role="alert" className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">{query.error instanceof Error ? query.error.message : 'Xatolik'}</p></div>
  }

  const { overview, history } = query.data
  const customer = overview.customer
  const metricCards = [
    ['Shartnomalar qiymati', nativeMoney(overview.metrics.contractValue)],
    ["Jami tushgan pul", nativeMoney(overview.metrics.cashCollected)],
    ["Bugun to'lanadi", nativeMoney(overview.metrics.dueToday)],
    ["Muddati o'tgan", nativeMoney(overview.metrics.overdue)],
    ['Qaytarilgan pul', nativeMoney(overview.metrics.refunds)],
    ['Hisobdan chiqarilgan qarz', nativeMoney(overview.metrics.writeOffs)],
    ['Hisob siyosati bo‘yicha yalpi foyda', `${Math.round(overview.metrics.accountingAccrualGrossProfitUzs).toLocaleString('ru-RU')} UZS`],
    ['Nasiya foizi', `${Math.round(overview.metrics.nasiyaInterestUzs).toLocaleString('ru-RU')} UZS`],
  ] as const
  const totalPages = Math.max(1, Math.ceil(history.total / history.take))

  return (
    <main className="space-y-5 p-4 sm:p-6">
      <Link href="/shop/mijozlar" className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900">
        <ArrowLeft className="size-4" aria-hidden="true" /> Mijozlarga qaytish
      </Link>

      <header className="rounded-lg border border-zinc-200 bg-white p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-xl font-bold text-zinc-900">{customer.name}</h1>
            <p className="mt-1 font-mono text-sm text-zinc-600">{formatUzPhoneDisplay(customer.phone)}</p>
            {customer.additionalPhones.map((phone) => <p key={phone} className="font-mono text-xs text-zinc-500">{formatUzPhoneDisplay(phone)}</p>)}
            <p className="mt-2 text-xs text-zinc-400">Mijoz: {uzDate(customer.createdAt)} dan beri</p>
          </div>
          <TrustBadge trust={overview.trust} />
        </div>
        {overview.trust.reasons.length > 0 && (
          <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-zinc-600">
            {overview.trust.reasons.map((reason) => <li key={reason}>{reason}</li>)}
          </ul>
        )}
        {customer.note && <p className="mt-3 whitespace-pre-wrap text-sm text-zinc-600">{customer.note}</p>}
      </header>

      <CustomerPassportPanel customerId={customer.id} passportMasked={customer.passportMasked} hasPassportPhoto={customer.hasPassportPhoto} />

      <section aria-label="Mijoz moliyaviy ko'rsatkichlari" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {metricCards.map(([label, value]) => (
          <div key={label} className="rounded-lg border border-zinc-200 bg-white p-4">
            <p className="text-xs text-zinc-500">{label}</p>
            <p className="mt-1 text-base font-semibold text-zinc-900">{value}</p>
          </div>
        ))}
      </section>
      {overview.metrics.legacyUsdPaymentCount > 0 && (
        <p className="rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          {overview.metrics.legacyUsdPaymentCount} ta eski USD to‘lovida shartnoma-valyuta miqdori saqlanmagan; jami ichiga taxminiy konvertatsiya qo‘shilmadi.
        </p>
      )}

      <section aria-labelledby="customer-history-title" className="rounded-lg border border-zinc-200 bg-white">
        <div className="border-b border-zinc-200 p-4">
          <h2 id="customer-history-title" className="text-sm font-semibold text-zinc-900">Mijoz tarixi</h2>
          <nav aria-label="Mijoz tarixi bo'limlari" className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {(Object.keys(SECTION_LABELS) as CustomerProfileSection[]).map((candidate) => (
              <Link
                key={candidate}
                href={href(candidate)}
                aria-current={candidate === section ? 'page' : undefined}
                className={cn('shrink-0 rounded-md px-3 py-1.5 text-xs font-medium', candidate === section ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200')}
              >
                {SECTION_LABELS[candidate]}
              </Link>
            ))}
          </nav>
        </div>

        {history.items.length === 0 ? (
          <p className="p-8 text-center text-sm text-zinc-500">Bu bo‘limda ma’lumot yo‘q</p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {history.items.map((item) => (
              <li key={item.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  {historyHref(item) ? (
                    <Link href={historyHref(item)!} className="truncate text-sm font-medium text-zinc-900 hover:underline">
                      {item.kind === 'resolution' ? historyStatusLabel(item.title) : item.title}
                    </Link>
                  ) : (
                    <p className="truncate text-sm font-medium text-zinc-900">
                      {item.kind === 'resolution' ? historyStatusLabel(item.title) : item.title}
                    </p>
                  )}
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
              </li>
            ))}
          </ul>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-zinc-200 p-4">
            <Link
              href={href(section, Math.max(1, page - 1))}
              aria-disabled={page <= 1}
              tabIndex={page <= 1 ? -1 : undefined}
              className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), page <= 1 && 'pointer-events-none opacity-50')}
            >
              <ChevronLeft className="mr-1 size-4" aria-hidden="true" /> Oldingi
            </Link>
            <span className="text-xs text-zinc-500">{page} / {totalPages}</span>
            <Link
              href={href(section, Math.min(totalPages, page + 1))}
              aria-disabled={page >= totalPages}
              tabIndex={page >= totalPages ? -1 : undefined}
              className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), page >= totalPages && 'pointer-events-none opacity-50')}
            >
              Keyingi <ChevronRight className="ml-1 size-4" aria-hidden="true" />
            </Link>
          </div>
        )}
      </section>
    </main>
  )
}
