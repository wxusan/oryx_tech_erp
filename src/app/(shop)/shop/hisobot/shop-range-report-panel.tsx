'use client'

import { CalendarRange, CircleDollarSign, Download, HandCoins, RotateCcw, TrendingUp, UserRoundCheck, WalletCards } from 'lucide-react'
import { Card, CardAction, CardContent, CardDescription, CardHeader } from '@/components/ui/card'
import { ExportDownloadButton } from '@/components/shop/export-download-button'
import { formatMoneyByCurrency, formatPartitionedMoney, type CurrencyContext } from '@/lib/currency'
import type { ShopRangeReport } from '@/lib/server/shop-report-range'
import HisobotActivityChartLoader from './hisobot-activity-chart-loader'

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
  const netCash = {
    uzs: totals.cashCollected.uzs - totals.refunds.uzs,
    usd: totals.cashCollected.usd - totals.refunds.usd,
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
      label: 'Sof tushum',
      value: partitionText(netCash, currency),
      note: "Haqiqiy tushum minus mijozlarga haqiqatda qaytarilgan pul",
      icon: WalletCards,
      color: 'text-emerald-700',
    },
    {
      label: 'Kutilayotgan foyda',
      value: partitionText(totals.expectedProfit, currency),
      note: "Faqat tanlangan oylarda muddati kelgan, hali to'lanmagan marja va foiz; kelgusi oylar kirmaydi",
      icon: WalletCards,
      color: 'text-violet-600',
    },
    {
      label: "To'lanishi kerak bo'lgan summa",
      value: partitionText(totals.expectedReceivables, currency),
      note: "Tanlangan oylarda muddati kelgan va hali to'lanmagan summa; keyingi oylar kirmaydi",
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
      label: 'Haqiqiy foyda',
      value: formatMoneyByCurrency(totals.grossProfitUzs, currency.currency, currency.usdUzsRate),
      note: `Olingan Nasiya foizi: ${formatMoneyByCurrency(totals.interestProfitUzs, currency.currency, currency.usdUzsRate)} · kutilayotgan: ${partitionText(totals.nasiyaInterestExpected, currency)}`,
      icon: TrendingUp,
      color: totals.grossProfitUzs < 0 ? 'text-red-600' : 'text-emerald-600',
    },
    {
      label: 'Bizning qarzlarimiz',
      value: partitionText(totals.supplierPayables, currency),
      note: `${totals.supplierPayables.count} ta ochiq qarz; due date tanlangan oylar ichida bo'lgan joriy qoldiq`,
      icon: HandCoins,
      color: 'text-amber-700',
    },
    {
      label: 'Bizga Pay Later qarzlar',
      value: partitionText(totals.customerPayLater, currency),
      note: `${totals.customerPayLater.count} ta ochiq Sotuv qoldig'i; Nasiya kiritilmagan`,
      icon: UserRoundCheck,
      color: 'text-blue-700',
    },
    {
      label: "Yetkazib beruvchiga to'langan",
      value: partitionText(totals.supplierPaymentsMade, currency),
      note: `${totals.supplierPaymentsMade.count} ta to'lov; mavjud Sof tushum va foyda formulalaridan ayrilmagan`,
      icon: HandCoins,
      color: 'text-zinc-600',
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
            <ExportDownloadButton href={exportHref('csv')} fallbackFilename="report.csv" variant="outline" size="sm" className="h-8">
              <Download data-icon="inline-start" /> CSV
            </ExportDownloadButton>
            <ExportDownloadButton href={exportHref('xlsx')} fallbackFilename="report.xlsx" variant="outline" size="sm" className="h-8">
              <Download data-icon="inline-start" /> Excel
            </ExportDownloadButton>
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

      <HisobotActivityChartLoader months={report.months} currencyContext={currency} />

      <Card className="rounded-lg">
        <CardHeader>
          <CardDescription>Oyma-oy hisob</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="min-w-[1460px] w-full text-left text-xs">
            <thead className="border-y border-zinc-200 bg-zinc-50 text-zinc-600">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Oy</th>
                <th scope="col" className="px-4 py-3 font-medium">Shartnomalar</th>
                <th scope="col" className="px-4 py-3 font-medium">Tushum</th>
                <th scope="col" className="px-4 py-3 font-medium">Haqiqiy foyda</th>
                <th scope="col" className="px-4 py-3 font-medium">Kutilayotgan foyda</th>
                <th scope="col" className="px-4 py-3 font-medium">Foiz: olingan / kutilayotgan</th>
                <th scope="col" className="px-4 py-3 font-medium">Muddati keladigan qarz</th>
                <th scope="col" className="px-4 py-3 font-medium">Bizning qarzlarimiz</th>
                <th scope="col" className="px-4 py-3 font-medium">Bizga Pay Later qarzlar</th>
                <th scope="col" className="px-4 py-3 font-medium">Yetkazib beruvchiga to&apos;langan</th>
                <th scope="col" className="px-4 py-3 font-medium">Qaytarish</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {report.months.map((month) => (
                <tr key={month.monthKey}>
                  <th scope="row" className="whitespace-nowrap px-4 py-3 font-medium text-zinc-900">{monthLabel(month.monthKey)}</th>
                  <td className="px-4 py-3 text-zinc-700">{partitionText(month.contracts, currency)}</td>
                  <td className="px-4 py-3 text-zinc-700">{partitionText(month.cashCollected, currency)}</td>
                  <td className={month.grossProfitUzs < 0 ? 'px-4 py-3 text-red-700' : 'px-4 py-3 text-emerald-700'}>
                    {formatMoneyByCurrency(month.grossProfitUzs, currency.currency, currency.usdUzsRate)}
                  </td>
                  <td className="px-4 py-3 text-zinc-700">{partitionText(month.expectedProfit, currency)}</td>
                  <td className="px-4 py-3 text-zinc-700">
                    {formatMoneyByCurrency(month.interestProfitUzs, currency.currency, currency.usdUzsRate)} / {partitionText(month.nasiyaInterestExpected, currency)}
                  </td>
                  <td className="px-4 py-3 text-zinc-700">{partitionText(month.expectedReceivables, currency)}</td>
                  <td className="px-4 py-3 text-zinc-700">{partitionText(month.supplierPayables, currency)} · {month.supplierPayables.count} ta</td>
                  <td className="px-4 py-3 text-zinc-700">{partitionText(month.customerPayLater, currency)} · {month.customerPayLater.count} ta</td>
                  <td className="px-4 py-3 text-zinc-700">{partitionText(month.supplierPaymentsMade, currency)} · {month.supplierPaymentsMade.count} ta</td>
                  <td className="px-4 py-3 text-zinc-700">{partitionText(month.refunds, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {(totals.writeOffCount > 0 || totals.reopenCount > 0) && (
        <details className="rounded-lg border border-amber-200 bg-amber-50/40">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-amber-900">Eski hisobdan chiqarish audit tarixi</summary>
          <div className="border-t border-amber-200 px-4 py-3 text-xs text-amber-900/80">
            Tarixiy summa: {partitionText(totals.writeOffs, currency)} · {totals.writeOffCount} ta eski hisobdan chiqarish, {totals.reopenCount} ta eski qayta ochish · hodisa paytidagi UZS: {formatMoneyByCurrency(totals.writeOffs.frozenUzs, 'UZS', currency.usdUzsRate)}.
            Yangi hisobdan chiqarish yaratish imkoniyati o&apos;chirilgan; bu ma&apos;lumotlar faqat audit uchun ko&apos;rsatiladi.
          </div>
        </details>
      )}
    </div>
  )
}
