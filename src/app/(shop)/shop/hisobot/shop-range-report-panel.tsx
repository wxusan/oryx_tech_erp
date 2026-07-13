'use client'

import { CalendarRange, CircleDollarSign, Download, FileX2, RotateCcw, TrendingUp, WalletCards } from 'lucide-react'
import { Card, CardAction, CardContent, CardDescription, CardHeader } from '@/components/ui/card'
import { buttonVariants } from '@/components/ui/button'
import { formatMoneyByCurrency, formatPartitionedMoney, type CurrencyContext } from '@/lib/currency'
import type { ShopRangeReport } from '@/lib/server/shop-report-range'
import { cn } from '@/lib/utils'

const UZ_MONTHS = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun', 'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr']

function monthLabel(monthKey: string) {
  const [year, month] = monthKey.split('-').map(Number)
  return `${UZ_MONTHS[(month ?? 1) - 1] ?? ''} ${year ?? ''}`.trim()
}

function partitionText(value: { uzs: number; usd: number }, currency: CurrencyContext) {
  return formatPartitionedMoney({
    amountUzs: value.uzs,
    amountUsd: value.usd,
    displayCurrency: currency.currency,
    rate: currency.usdUzsRate,
  })
}

function TrendBars({ report, currency }: { report: ShopRangeReport; currency: CurrencyContext }) {
  const maxUzs = Math.max(1, ...report.months.flatMap((month) => [month.cashCollected.uzs, Math.abs(month.grossProfitUzs)]))
  const maxUsd = Math.max(1, ...report.months.map((month) => month.cashCollected.usd))

  return (
    <Card className="rounded-lg">
      <CardHeader>
        <CardDescription>Oylik trend</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-3" aria-label="UZS bo'yicha oylik tushum va foyda trendi">
          <div className="text-xs font-medium text-zinc-600">UZS — tushum / sotuv foydasi</div>
          {report.months.map((month) => (
            <div key={`uzs-${month.monthKey}`} className="grid grid-cols-[88px_1fr] items-center gap-3">
              <span className="text-xs text-zinc-500">{monthLabel(month.monthKey)}</span>
              <div className="space-y-1">
                <div className="h-2 rounded-full bg-zinc-100" title={`Tushum: ${formatMoneyByCurrency(month.cashCollected.uzs, 'UZS', currency.usdUzsRate)}`}>
                  <div className="h-2 rounded-full bg-blue-600" style={{ width: `${Math.max(0, month.cashCollected.uzs / maxUzs) * 100}%` }} />
                </div>
                <div className="h-2 rounded-full bg-zinc-100" title={`Foyda: ${formatMoneyByCurrency(month.grossProfitUzs, 'UZS', currency.usdUzsRate)}`}>
                  <div
                    className={`h-2 rounded-full ${month.grossProfitUzs < 0 ? 'bg-red-500' : 'bg-emerald-600'}`}
                    style={{ width: `${Math.max(0, Math.abs(month.grossProfitUzs) / maxUzs) * 100}%` }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        {report.months.some((month) => month.cashCollected.usd > 0) && (
          <div className="space-y-3 border-t border-zinc-100 pt-4" aria-label="USD bo'yicha oylik tushum trendi">
            <div className="text-xs font-medium text-zinc-600">USD — tushum</div>
            {report.months.map((month) => (
              <div key={`usd-${month.monthKey}`} className="grid grid-cols-[88px_1fr] items-center gap-3">
                <span className="text-xs text-zinc-500">{monthLabel(month.monthKey)}</span>
                <div className="h-2 rounded-full bg-zinc-100" title={`Tushum: ${formatMoneyByCurrency(month.cashCollected.usd, 'USD', currency.usdUzsRate)}`}>
                  <div className="h-2 rounded-full bg-indigo-500" style={{ width: `${Math.max(0, month.cashCollected.usd / maxUsd) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export default function ShopRangeReportPanel({
  report,
  currency,
  canExport,
}: {
  report: ShopRangeReport
  currency: CurrencyContext
  canExport: boolean
}) {
  const totals = report.totals
  const label = report.range.startMonth === report.range.endMonth
    ? monthLabel(report.range.startMonth)
    : `${monthLabel(report.range.startMonth)} — ${monthLabel(report.range.endMonth)}`
  const exportHref = (format: 'csv' | 'xlsx') => {
    const params = new URLSearchParams({ preset: report.range.preset, format })
    if (report.range.preset === 'single') params.set('month', report.range.startMonth)
    if (report.range.preset === 'custom') params.set('startMonth', report.range.startMonth)
    if (report.range.preset !== 'single') params.set('endMonth', report.range.endMonth)
    if (report.filteredByAdmin) params.set('admin', report.filteredByAdmin)
    return `/api/export/report?${params.toString()}`
  }

  const cards = [
    {
      label: 'Haqiqiy tushum',
      value: partitionText(totals.cashCollected, currency),
      note: totals.cashCollected.complete ? "Haqiqatan qabul qilingan to'lovlar" : "Eski USD yozuvlarining ayrimida asl summa yetishmaydi",
      icon: CircleDollarSign,
      color: 'text-blue-600',
    },
    {
      label: 'Sotuv qiymati',
      value: partitionText(totals.accrualRevenue, currency),
      note: "Oraliqda tuzilgan sotuv va nasiya shartnomalari; import qarzlar kirmaydi",
      icon: WalletCards,
      color: 'text-violet-600',
    },
    {
      label: 'Kutilayotgan qarz',
      value: partitionText(totals.expectedReceivables, currency),
      note: "Tanlangan oylarda muddati keladigan joriy ochiq majburiyatlar",
      icon: CalendarRange,
      color: 'text-teal-700',
    },
    {
      label: 'Qaytarilgan pul',
      value: partitionText(totals.refunds, currency),
      note: `${totals.returnCount} ta qaytarish; asl shartnoma valyutasida`,
      icon: RotateCcw,
      color: 'text-purple-600',
    },
    {
      label: 'Hisobdan chiqarilgan',
      value: partitionText(totals.writeOffs, currency),
      note: `${totals.writeOffCount} ta chiqarish, ${totals.reopenCount} ta qayta ochish · muzlatilgan UZS: ${formatMoneyByCurrency(totals.writeOffs.frozenUzs, 'UZS', currency.usdUzsRate)}`,
      icon: FileX2,
      color: 'text-orange-700',
    },
    {
      label: 'Sotuv foydasi',
      value: formatMoneyByCurrency(totals.grossProfitUzs, currency.currency, currency.usdUzsRate),
      note: `Nasiya foizi alohida: ${formatMoneyByCurrency(totals.interestProfitUzs, currency.currency, currency.usdUzsRate)}`,
      icon: TrendingUp,
      color: totals.grossProfitUzs < 0 ? 'text-red-600' : 'text-emerald-600',
    },
  ]

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-sm font-semibold text-zinc-900">{label}</div>
          <p className="mt-1 text-xs text-zinc-500">
            Oraliqdagi nol oylar trendda ataylab ko'rsatiladi. USD va UZS xom summalari hech qachon bir-biriga qo'shilmaydi.
          </p>
        </div>
        {canExport && (
          <div className="flex shrink-0 gap-2">
            <a href={exportHref('csv')} className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'h-8')}>
              <Download data-icon="inline-start" /> CSV
            </a>
            <a href={exportHref('xlsx')} className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'h-8')}>
              <Download data-icon="inline-start" /> Excel
            </a>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => (
          <Card key={card.label} className="rounded-lg">
            <CardHeader>
              <CardDescription>{card.label}</CardDescription>
              <CardAction><card.icon className={`size-4 ${card.color}`} /></CardAction>
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold text-zinc-900">{card.value}</div>
              <p className="mt-3 text-xs text-zinc-500">{card.note}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <TrendBars report={report} currency={currency} />

      <Card className="rounded-lg">
        <CardHeader>
          <CardDescription>Oyma-oy hisob</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="min-w-[920px] w-full text-left text-xs">
            <thead className="border-y border-zinc-200 bg-zinc-50 text-zinc-600">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Oy</th>
                <th scope="col" className="px-4 py-3 font-medium">Tushum</th>
                <th scope="col" className="px-4 py-3 font-medium">Sotuv qiymati</th>
                <th scope="col" className="px-4 py-3 font-medium">Kutilmoqda</th>
                <th scope="col" className="px-4 py-3 font-medium">Qaytarish</th>
                <th scope="col" className="px-4 py-3 font-medium">Hisobdan chiqarish</th>
                <th scope="col" className="px-4 py-3 font-medium">Foyda</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {report.months.map((month) => (
                <tr key={month.monthKey}>
                  <th scope="row" className="whitespace-nowrap px-4 py-3 font-medium text-zinc-900">{monthLabel(month.monthKey)}</th>
                  <td className="px-4 py-3 text-zinc-700">{partitionText(month.cashCollected, currency)}</td>
                  <td className="px-4 py-3 text-zinc-700">{partitionText(month.accrualRevenue, currency)}</td>
                  <td className="px-4 py-3 text-zinc-700">{partitionText(month.expectedReceivables, currency)}</td>
                  <td className="px-4 py-3 text-zinc-700">{partitionText(month.refunds, currency)}</td>
                  <td className="px-4 py-3 text-zinc-700">{partitionText(month.writeOffs, currency)}</td>
                  <td className={month.grossProfitUzs < 0 ? 'px-4 py-3 text-red-700' : 'px-4 py-3 text-emerald-700'}>
                    {formatMoneyByCurrency(month.grossProfitUzs, currency.currency, currency.usdUzsRate)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  )
}
