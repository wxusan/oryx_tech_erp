'use client'

import { useState } from 'react'
import { MonthlyActivityChart, type MonthlyActivityCurrency } from '@/components/shop/monthly-activity-chart'
import type { CurrencyContext } from '@/lib/currency'
import type { ShopMonthlyReportPoint } from '@/lib/server/shop-report-range'
import { cn } from '@/lib/utils'

function hasCurrencyActivity(months: ShopMonthlyReportPoint[], currency: MonthlyActivityCurrency) {
  const key = currency.toLowerCase() as 'uzs' | 'usd'
  return months.some((month) => (
    month.contracts[key] !== 0
    || month.cashCollected[key] !== 0
    || month.refunds[key] !== 0
    || month.waivedNasiyaProfit[key] !== 0
    || month.writeOffs[key] !== 0
  ))
}

export default function HisobotActivityChart({
  months,
  currencyContext,
}: {
  months: ShopMonthlyReportPoint[]
  currencyContext: CurrencyContext
}) {
  const availableCurrencies = (['UZS', 'USD'] as MonthlyActivityCurrency[])
    .filter((currency) => hasCurrencyActivity(months, currency))
  const preferredCurrency = currencyContext.currency as MonthlyActivityCurrency
  const [selectedCurrency, setSelectedCurrency] = useState<MonthlyActivityCurrency>(
    availableCurrencies.includes(preferredCurrency) ? preferredCurrency : availableCurrencies[0] ?? preferredCurrency,
  )
  const currency = availableCurrencies.includes(selectedCurrency)
    ? selectedCurrency
    : availableCurrencies.includes(preferredCurrency)
      ? preferredCurrency
      : availableCurrencies[0] ?? preferredCurrency
  const activity = months.map((month) => ({
    month: month.monthKey,
    contracts: { UZS: month.contracts.uzs, USD: month.contracts.usd },
    payments: { UZS: month.cashCollected.uzs, USD: month.cashCollected.usd },
    refunds: { UZS: month.refunds.uzs, USD: month.refunds.usd },
    waivedProfit: { UZS: month.waivedNasiyaProfit.uzs, USD: month.waivedNasiyaProfit.usd },
    writeOffs: { UZS: month.writeOffs.uzs, USD: month.writeOffs.usd },
  }))
  const toolbar = availableCurrencies.length > 1 ? (
    <div className="inline-flex rounded-lg border border-zinc-200 bg-white p-1" aria-label="Grafik valyutasi">
      {availableCurrencies.map((item) => (
        <button
          key={item}
          type="button"
          aria-pressed={currency === item}
          onClick={() => setSelectedCurrency(item)}
          className={cn(
            'min-h-7 rounded-md px-2.5 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900',
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
  )

  return (
    <MonthlyActivityChart
      activity={activity}
      currency={currency}
      showFinancials
      titleId="shop-activity-chart-title"
      toolbar={toolbar}
    />
  )
}
