'use client'

import { useCallback, useEffect, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { CustomerPassportPanel } from '@/components/shop/customer-passport-panel'
import { useAuthenticatedQueryScope } from '@/components/query-scope-context'
import { QueryActivity } from '@/components/query-activity'
import { markQueryIntent } from '@/lib/client-performance'
import type { CustomerProfileAnalytics, CustomerProfileAnalyticsMonths } from '@/lib/customer-profile-analytics'
import { replaceListUrlState } from '@/lib/list-url-state'
import { queryKeys } from '@/lib/query-keys'
import type {
  CustomerProfileHistory,
  CustomerProfileOverview,
  CustomerProfileSection,
} from '@/lib/server/customer-profile'
import { CustomerProfileCounts } from './customer-profile-counts'
import { CustomerProfileDashboard } from './customer-profile-dashboard'
import { CustomerProfileHeader } from './customer-profile-header'
import { CustomerProfileHistorySection } from './customer-profile-history'
import { CustomerProfileMetrics } from './customer-profile-metrics'

interface ApiEnvelope<T> {
  success: boolean
  data?: T
  error?: string
}

const PROFILE_STALE_TIME_MS = 120_000

export function CustomerProfileClient({
  customerId,
  initialOverview,
  initialAnalytics,
  initialHistory,
  initialSection,
  initialPage,
}: {
  customerId: string
  initialOverview: CustomerProfileOverview
  initialAnalytics: CustomerProfileAnalytics
  initialHistory: CustomerProfileHistory
  initialSection: CustomerProfileSection
  initialPage: number
}) {
  const scope = useAuthenticatedQueryScope()
  const [section, setSection] = useState<CustomerProfileSection>(initialSection)
  const [page, setPage] = useState(initialPage)
  const [months, setMonths] = useState<CustomerProfileAnalyticsMonths>(initialAnalytics.months)

  const fetchOverview = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(`/api/customers/${customerId}/profile?view=overview`, { signal, cache: 'no-store' })
    const json = await response.json() as ApiEnvelope<{ overview: CustomerProfileOverview }>
    if (!response.ok || !json.success || !json.data) throw new Error(json.error || "Mijoz profilini yuklab bo'lmadi")
    return json.data.overview
  }, [customerId])

  const fetchAnalytics = useCallback(async (range: CustomerProfileAnalyticsMonths, signal?: AbortSignal) => {
    const response = await fetch(`/api/customers/${customerId}/analytics?months=${range}`, { signal, cache: 'no-store' })
    const json = await response.json() as ApiEnvelope<CustomerProfileAnalytics>
    if (!response.ok || !json.success || !json.data) throw new Error(json.error || "Mijoz tahlilini yuklab bo'lmadi")
    return json.data
  }, [customerId])

  const fetchHistory = useCallback(async (
    nextSection: CustomerProfileSection,
    nextPage: number,
    signal?: AbortSignal,
  ) => {
    const params = new URLSearchParams({ view: 'history', section: nextSection, page: String(nextPage) })
    const response = await fetch(`/api/customers/${customerId}/profile?${params}`, { signal, cache: 'no-store' })
    const json = await response.json() as ApiEnvelope<{ section: CustomerProfileSection; history: CustomerProfileHistory }>
    if (!response.ok || !json.success || !json.data) throw new Error(json.error || "Mijoz tarixini yuklab bo'lmadi")
    return json.data.history
  }, [customerId])

  const overviewQuery = useQuery({
    queryKey: queryKeys.list(scope, 'customers', { surface: 'profile-overview', customerId }),
    queryFn: ({ signal }) => fetchOverview(signal),
    initialData: initialOverview,
    staleTime: PROFILE_STALE_TIME_MS,
  })
  const analyticsQuery = useQuery({
    queryKey: queryKeys.list(scope, 'customers', { surface: 'profile-analytics', customerId, months }),
    queryFn: ({ signal }) => fetchAnalytics(months, signal),
    initialData: months === initialAnalytics.months ? initialAnalytics : undefined,
    placeholderData: keepPreviousData,
    staleTime: PROFILE_STALE_TIME_MS,
  })
  const historyQuery = useQuery({
    queryKey: queryKeys.list(scope, 'customers', { surface: 'profile-history', customerId, section, page, take: 20 }),
    queryFn: ({ signal }) => fetchHistory(section, page, signal),
    initialData: section === initialSection && page === initialPage ? initialHistory : undefined,
    placeholderData: keepPreviousData,
    staleTime: PROFILE_STALE_TIME_MS,
  })

  useEffect(() => {
    replaceListUrlState({ section, page })
  }, [page, section])

  const overview = overviewQuery.data ?? initialOverview
  const analytics = analyticsQuery.data ?? initialAnalytics
  const history = historyQuery.data ?? initialHistory
  const canSeeOwnerFinancials = analytics.visibility === 'OWNER_FINANCIAL'
  const overviewError = overviewQuery.error instanceof Error ? overviewQuery.error.message : null
  const analyticsError = analyticsQuery.error instanceof Error ? analyticsQuery.error.message : null
  const historyError = historyQuery.error instanceof Error ? historyQuery.error.message : null

  function selectMonths(nextMonths: CustomerProfileAnalyticsMonths) {
    if (nextMonths === months) return
    markQueryIntent('customer-profile-analytics')
    setMonths(nextMonths)
  }

  function selectSection(nextSection: CustomerProfileSection) {
    if (nextSection === section) return
    markQueryIntent('customer-profile-history')
    setSection(nextSection)
    setPage(1)
  }

  function selectPage(nextPage: number) {
    if (nextPage === page) return
    markQueryIntent('customer-profile-history')
    setPage(Math.max(1, nextPage))
  }

  return (
    <main className="space-y-5 p-4 sm:p-6 lg:p-8">
      <CustomerProfileHeader overview={overview} />

      <QueryActivity
        isFetching={overviewQuery.isFetching}
        error={overviewError}
        onRetry={() => { markQueryIntent('customer-profile-overview'); void overviewQuery.refetch() }}
        label="Asosiy ko‘rsatkichlar yangilanmoqda"
        metricId="customer-profile-overview"
      >
        <CustomerProfileMetrics overview={overview} analytics={analytics} />
      </QueryActivity>

      <CustomerProfileDashboard
        analytics={analytics}
        selectedMonths={months}
        isFetching={analyticsQuery.isFetching}
        error={analyticsError}
        onMonthsChange={selectMonths}
        onRetry={() => { markQueryIntent('customer-profile-analytics'); void analyticsQuery.refetch() }}
      />

      <CustomerProfileCounts counts={analytics.counts} />

      <CustomerPassportPanel
        customerId={overview.customer.id}
        passportMasked={overview.customer.passportMasked}
        hasPassportPhoto={overview.customer.hasPassportPhoto}
      />

      <CustomerProfileHistorySection
        history={history}
        section={section}
        page={page}
        canSeeOwnerFinancials={canSeeOwnerFinancials}
        isFetching={historyQuery.isFetching}
        error={historyError}
        onSectionChange={selectSection}
        onPageChange={selectPage}
        onRetry={() => { markQueryIntent('customer-profile-history'); void historyQuery.refetch() }}
      />
    </main>
  )
}
