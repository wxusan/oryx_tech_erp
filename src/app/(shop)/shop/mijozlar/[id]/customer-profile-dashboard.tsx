'use client'

import { useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Clock3, Gauge, Loader2 } from 'lucide-react'
import { QueryActivity } from '@/components/query-activity'
import {
  CUSTOMER_PROFILE_ANALYTICS_RANGES,
  totalDueBuckets,
  type CustomerProfileAnalytics,
  type CustomerProfileAnalyticsMonths,
  type CustomerProfileCurrency,
} from '@/lib/customer-profile-analytics'
import { useShopCurrency } from '@/lib/use-shop-currency'
import { cn } from '@/lib/utils'
import CustomerProfileChartsLoader from './customer-profile-charts-loader'

function hasCurrencyData(analytics: CustomerProfileAnalytics, currency: CustomerProfileCurrency) {
  return totalDueBuckets(analytics.obligations[currency]) > 0 || analytics.activity.some((row) => (
    row.contracts[currency] !== 0
    || (row.payments?.[currency] ?? 0) !== 0
    || (row.refunds?.[currency] ?? 0) !== 0
    || (row.writeOffs?.[currency] ?? 0) !== 0
  ))
}

function Discipline({ analytics }: { analytics: CustomerProfileAnalytics }) {
  const discipline = analytics.discipline
  const onTimePercent = discipline.onTimeRatio == null ? 0 : Math.round(discipline.onTimeRatio * 100)

  return (
    <section aria-labelledby="payment-discipline-title" className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 id="payment-discipline-title" className="text-sm font-semibold text-zinc-950">To‘lov intizomi</h3>
          <p className="mt-1 text-xs text-zinc-500">Yakunlangan nasiya to‘lovlarining muddatga rioya qilishi.</p>
        </div>
        <Gauge className="size-5 text-zinc-400" aria-hidden="true" />
      </div>

      {discipline.paidInstallments === 0 ? (
        <div className="mt-4 rounded-lg border border-dashed border-zinc-200 bg-zinc-50 px-4 py-6 text-center">
          <p className="text-sm font-medium text-zinc-800">To‘lov tarixi yetarli emas</p>
          <p className="mt-1 text-xs text-zinc-500">Yakunlangan bo‘lib to‘lashlar paydo bo‘lganda ulush hisoblanadi.</p>
        </div>
      ) : (
        <div className="mt-5">
          <div className="flex items-end justify-between gap-3">
            <p className="text-3xl font-bold tracking-tight text-zinc-950">{onTimePercent}%</p>
            <p className="text-right text-xs text-zinc-500">
              {discipline.onTimeInstallments} / {discipline.paidInstallments} ta to‘lov o‘z vaqtida
            </p>
          </div>
          <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-zinc-100" aria-label={`${onTimePercent}% to‘lov o‘z vaqtida`}>
            <span className="bg-emerald-600" style={{ width: `${onTimePercent}%` }} />
            <span className="bg-amber-400" style={{ width: `${100 - onTimePercent}%` }} />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
            <span className="inline-flex items-center gap-1.5 text-emerald-700"><CheckCircle2 className="size-3.5" /> O‘z vaqtida: {discipline.onTimeInstallments}</span>
            <span className="inline-flex items-center gap-1.5 text-amber-700"><Clock3 className="size-3.5" /> Kechikkan: {discipline.lateInstallments}</span>
            <span className="col-span-2 text-zinc-600 sm:col-span-1">Eng ko‘p: {discipline.maxDaysLate} kun</span>
          </div>
        </div>
      )}

      {discipline.currentOverdueSchedules > 0 && (
        <p className="mt-4 inline-flex w-full items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-800">
          <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
          Hozir {discipline.currentOverdueSchedules} ta muddati o‘tgan jadval mavjud.
        </p>
      )}
    </section>
  )
}

export function CustomerProfileDashboard({
  analytics,
  selectedMonths,
  isFetching,
  error,
  onMonthsChange,
  onRetry,
}: {
  analytics: CustomerProfileAnalytics
  selectedMonths: CustomerProfileAnalyticsMonths
  isFetching: boolean
  error: string | null
  onMonthsChange: (months: CustomerProfileAnalyticsMonths) => void
  onRetry: () => void
}) {
  const { currency: shopCurrency } = useShopCurrency()
  const availableCurrencies = useMemo(() => (
    (['UZS', 'USD'] as CustomerProfileCurrency[]).filter((currency) => hasCurrencyData(analytics, currency))
  ), [analytics])
  const preferred = shopCurrency.currency as CustomerProfileCurrency
  const [selectedCurrency, setSelectedCurrency] = useState<CustomerProfileCurrency>(
    availableCurrencies.includes(preferred) ? preferred : availableCurrencies[0] ?? preferred,
  )
  const currency = availableCurrencies.includes(selectedCurrency)
    ? selectedCurrency
    : availableCurrencies.includes(preferred) ? preferred : availableCurrencies[0] ?? preferred

  return (
    <section aria-labelledby="customer-insights-title" className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 id="customer-insights-title" className="text-base font-semibold text-zinc-950">Mijoz tahlili</h2>
          <p className="mt-0.5 text-xs text-zinc-500">Faollik, qarz muddati va to‘lov odati bir joyda.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-zinc-200 bg-white p-1" aria-label="Tahlil davri">
            {CUSTOMER_PROFILE_ANALYTICS_RANGES.map((months) => (
              <button
                key={months}
                type="button"
                aria-pressed={selectedMonths === months}
                onClick={() => onMonthsChange(months)}
                className={cn(
                  'min-h-9 rounded-md px-3 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900',
                  selectedMonths === months ? 'bg-zinc-950 text-white' : 'text-zinc-600 hover:bg-zinc-100',
                )}
              >
                {months} oy
              </button>
            ))}
          </div>
          {availableCurrencies.length > 1 ? (
            <div className="inline-flex rounded-lg border border-zinc-200 bg-white p-1" aria-label="Grafik valyutasi">
              {availableCurrencies.map((item) => (
                <button
                  key={item}
                  type="button"
                  aria-pressed={currency === item}
                  onClick={() => setSelectedCurrency(item)}
                  className={cn(
                    'min-h-9 rounded-md px-3 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900',
                    currency === item ? 'bg-zinc-950 text-white' : 'text-zinc-600 hover:bg-zinc-100',
                  )}
                >
                  {item}
                </button>
              ))}
            </div>
          ) : (
            <span className="inline-flex min-h-9 items-center rounded-lg border border-zinc-200 bg-white px-3 text-xs font-semibold text-zinc-700">
              {currency}
            </span>
          )}
          {isFetching && <Loader2 className="size-4 animate-spin text-zinc-500" aria-label="Tahlil yangilanmoqda" />}
        </div>
      </div>

      <QueryActivity
        isFetching={isFetching}
        error={error}
        onRetry={onRetry}
        label="Mijoz tahlili yangilanmoqda"
        metricId="customer-profile-analytics"
      >
        <div className="space-y-4">
          <CustomerProfileChartsLoader analytics={analytics} currency={currency} />
          <Discipline analytics={analytics} />
        </div>
      </QueryActivity>

      {analytics.caveats.legacyUsdPaymentCount != null && analytics.caveats.legacyUsdPaymentCount > 0 && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          {analytics.caveats.legacyUsdPaymentCount} ta eski USD to‘lovida shartnoma-valyuta miqdori saqlanmagan; grafik taxminiy konvertatsiya qilmaydi.
        </p>
      )}
    </section>
  )
}
