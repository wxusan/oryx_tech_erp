'use client'

import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Boxes, CalendarClock, CircleDollarSign, Download, HandCoins, RotateCcw, TrendingUp, UserRoundCheck, WalletCards } from 'lucide-react'
import { Card, CardAction, CardContent, CardDescription, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ExportDownloadButton } from '@/components/shop/export-download-button'
import type { ChartConfig } from '@/components/ui/chart'
import type { getShopStats } from '@/lib/server/shop-stats'
import type { ShopRangeReport } from '@/lib/server/shop-report-range'
import type { ReportRangePreset } from '@/lib/report-range'
import { formatMoneyByCurrency, formatPartitionedMoney, type CurrencyContext } from '@/lib/currency'
import HisobotChartsLoader from './hisobot-charts-loader'
import HisobotActivityChartLoader from './hisobot-activity-chart-loader'
import HisobotFilters from './hisobot-filters'
import ShopRangeReportPanel from './shop-range-report-panel'
import { queryKeys } from '@/lib/query-keys'
import { useAuthenticatedQueryScope } from '@/components/query-scope-context'
import { useShopAccess } from '@/components/shop/shop-access-context'

type ShopStats = Awaited<ReturnType<typeof getShopStats>>
type ShopAdminOption = { id: string; name: string }
type MonthOption = { value: string; label: string }

function fmt(value: number, currency: CurrencyContext) {
  return formatMoneyByCurrency(value, currency.currency, currency.usdUzsRate)
}

const UZ_MONTHS = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun', 'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr']

/** Item 8 — parses a `YYYY-MM` key directly (never a Date's local-timezone getters, which would drift from Tashkent on a non-Tashkent server). */
function uzMonthLabelFromKey(monthKey: string) {
  const [year, month] = monthKey.split('-').map(Number)
  return `${UZ_MONTHS[(month ?? 1) - 1] ?? ''} ${year ?? ''}`.trim()
}

export default function HisobotClient({
  initialStats,
  currency,
  shopAdmins,
  monthOptions,
  initialRangeReport,
  preset,
  startMonth,
  endMonth,
  monthKey,
  adminId,
}: {
  initialStats: ShopStats
  currency: CurrencyContext
  shopAdmins: ShopAdminOption[]
  monthOptions: MonthOption[]
  initialRangeReport: ShopRangeReport | null
  preset: ReportRangePreset
  startMonth: string
  endMonth: string
  monthKey: string | null
  adminId: string | null
}) {
  const scope = useAuthenticatedQueryScope()
  const { can } = useShopAccess()
  const statsQuery = useQuery({
    queryKey: queryKeys.list(scope, 'reports', { view: 'hisobot', monthKey, adminId }),
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams()
      if (monthKey) params.set('month', monthKey)
      if (adminId) params.set('admin', adminId)
      const response = await fetch(`/api/stats/shop?${params.toString()}`, { signal, cache: 'no-store' })
      const json = await response.json() as { success: boolean; data?: ShopStats; error?: string }
      if (!response.ok || !json.success || !json.data) throw new Error(json.error || 'Hisobot yuklanmadi')
      return json.data
    },
    initialData: initialStats,
    enabled: preset === 'single',
  })
  const rangeQuery = useQuery({
    queryKey: queryKeys.list(scope, 'reports', {
      view: 'hisobot-range',
      preset,
      month: monthKey,
      startMonth,
      endMonth,
      adminId,
    }),
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ preset })
      if (monthKey) params.set('month', monthKey)
      if (preset === 'custom') params.set('startMonth', startMonth)
      if (preset !== 'single') params.set('endMonth', endMonth)
      if (adminId) params.set('admin', adminId)
      const response = await fetch(`/api/reports/shop?${params.toString()}`, { signal, cache: 'no-store' })
      const json = await response.json() as {
        success: boolean
        data?: { availableMonths: string[]; report: ShopRangeReport | null }
        error?: string
      }
      if (!response.ok || !json.success || !json.data) throw new Error(json.error || 'Hisobot yuklanmadi')
      return json.data
    },
    initialData: {
      availableMonths: monthOptions.map((option) => option.value),
      report: initialRangeReport,
    },
  })
  const stats = statsQuery.data
  const rangeReport = rangeQuery.data.report
  const liveMonthOptions = rangeQuery.data.availableMonths.map((month) => ({
    value: month,
    label: uzMonthLabelFromKey(month),
  }))
  const singleExportHref = (format: 'csv' | 'xlsx') => {
    const params = new URLSearchParams({ preset: 'single', month: startMonth, format })
    if (adminId) params.set('admin', adminId)
    return `/api/export/report?${params.toString()}`
  }
  const monthLabel = preset === 'single'
    ? uzMonthLabelFromKey(stats.monthKey)
    : `${uzMonthLabelFromKey(startMonth)} — ${uzMonthLabelFromKey(endMonth)}`
  const collected = stats.grossCashInThisMonth ?? stats.cashCollectedThisMonth ?? stats.cashReceivedThisMonth
  const netCash = stats.netCashFlowThisMonth ?? stats.netCashAfterReturnsThisMonth
  const expected = stats.expectedThisMonth
  const overdue = stats.overdueMoney
  const refunds = stats.returnRefundsThisMonth
  const reversedRevenue = stats.returnRevenueReversalsThisMonth ?? 0
  const recoveredInventoryCost = stats.returnInventoryCostRecoveriesThisMonth ?? 0
  const retainedReturnValue = stats.returnRetainedValueThisMonth ?? 0
  const inventory = stats.inventoryPurchaseCost
  const grossProfit = stats.actualProfitThisMonth ?? stats.realProfitThisMonth
  const interestProfit = stats.interestReceivedThisMonth ?? 0
  const currencyTotalsComplete = stats.expectedThisMonthComplete && stats.overdueMoneyComplete
  const expectedText = formatPartitionedMoney({
    amountUzs: stats.expectedThisMonthUzs,
    amountUsd: stats.expectedThisMonthUsd,
    displayCurrency: currency.currency,
    rate: currency.usdUzsRate,
  })
  const expectedReceivablesText = formatPartitionedMoney({
    amountUzs: stats.expectedReceivablesThisMonthUzs,
    amountUsd: stats.expectedReceivablesThisMonthUsd,
    displayCurrency: currency.currency,
    rate: currency.usdUzsRate,
  })
  const overdueText = formatPartitionedMoney({
    amountUzs: stats.overdueMoneyUzs,
    amountUsd: stats.overdueMoneyUsd,
    displayCurrency: currency.currency,
    rate: currency.usdUzsRate,
  })
  const expectedInterestText = formatPartitionedMoney({
    amountUzs: stats.nasiyaInterestExpectedThisMonthUzs,
    amountUsd: stats.nasiyaInterestExpectedThisMonthUsd,
    displayCurrency: currency.currency,
    rate: currency.usdUzsRate,
  })
  const supplierDebtText = formatPartitionedMoney({
    amountUzs: stats.supplierPayablesOpenAllTimeUzs,
    amountUsd: stats.supplierPayablesOpenAllTimeUsd,
    displayCurrency: currency.currency,
    rate: currency.usdUzsRate,
  })
  const customerPayLaterText = formatPartitionedMoney({
    amountUzs: stats.customerPayLaterOpenAllTimeUzs,
    amountUsd: stats.customerPayLaterOpenAllTimeUsd,
    displayCurrency: currency.currency,
    rate: currency.usdUzsRate,
  })
  const supplierPaymentsText = formatPartitionedMoney({
    amountUzs: stats.supplierPaymentsMadeSelectedMonthUzs,
    amountUsd: stats.supplierPaymentsMadeSelectedMonthUsd,
    displayCurrency: currency.currency,
    rate: currency.usdUzsRate,
  })
  const cashFlowData = [
    {
      name: 'Umumiy aylanma',
      amount: collected,
      fill: 'var(--color-collected)',
    },
    { name: 'Sof tushum', amount: netCash, fill: 'var(--color-net)' },
    {
      name: 'Qaytarilgan summa',
      amount: refunds,
      fill: 'var(--color-refunds)',
    },
    { name: 'Kutilayotgan foyda', amount: expected, fill: 'var(--color-expected)' },
    { name: 'Kechikkan', amount: overdue, fill: 'var(--color-overdue)' },
  ]

  const businessData = [
    { name: 'Ombor', amount: inventory, fill: 'var(--color-inventory)' },
    { name: 'Haqiqiy foyda', amount: grossProfit, fill: 'var(--color-gross)' },
    {
      name: 'Olingan Nasiya foizi',
      amount: interestProfit,
      fill: 'var(--color-interest)',
    },
  ]

  const chartConfig = {
    collected: { label: 'Umumiy aylanma', color: '#2563eb' },
    net: { label: 'Sof tushum', color: '#15803d' },
    refunds: { label: 'Qaytarilgan summa', color: '#9333ea' },
    expected: { label: 'Kutilayotgan foyda', color: '#0f766e' },
    overdue: { label: 'Kechikkan', color: '#dc2626' },
    inventory: { label: 'Ombor', color: '#64748b' },
    gross: { label: 'Haqiqiy foyda', color: '#16a34a' },
    interest: { label: 'Olingan Nasiya foizi', color: '#0891b2' },
  } satisfies ChartConfig

  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="rounded-md border-zinc-200 bg-white text-zinc-600">
              {monthLabel} · {currency.currency}
            </Badge>
            <Badge variant={overdue > 0 ? 'destructive' : 'secondary'} className="rounded-md">
              {overdue > 0 ? "Kechikkan to'lov bor" : "Kechikkan to'lov yo'q"}
            </Badge>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900">Hisobot</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Haqiqiy tushum va foyda, shu oy kutilayotgan foyda, qarzdorlik hamda ombor ko'rsatkichlari
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <HisobotFilters
            monthOptions={liveMonthOptions}
            preset={preset}
            selectedMonth={monthKey}
            startMonth={startMonth}
            endMonth={endMonth}
            admins={shopAdmins}
            selectedAdmin={adminId}
          />
          <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-500">
            To'langan va kutilayotgan foyda alohida hisoblanadi
          </div>
          {preset === 'single' && rangeReport && can('EXPORT_REPORTS') && (
            <div className="flex gap-2">
              <ExportDownloadButton href={singleExportHref('csv')} fallbackFilename="report.csv" variant="outline" size="sm" className="h-9">
                <Download data-icon="inline-start" /> CSV
              </ExportDownloadButton>
              <ExportDownloadButton href={singleExportHref('xlsx')} fallbackFilename="report.xlsx" variant="outline" size="sm" className="h-9">
                <Download data-icon="inline-start" /> Excel
              </ExportDownloadButton>
            </div>
          )}
        </div>
      </div>

      {adminId && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          Admin filtri shartnomani yaratgan, to'lovni, qaytarishni yoki nasiya yopish kelishuvini yozgan xodim harakatlarini alohida bog'laydi; marja va Nasiya foizi to'lovni yozgan xodimga tegishli.
          Ombordagi tannarx, faol nasiyalar, kutilayotgan foyda va kechikkan qarzdorlik do'kon bo'yicha ko'rsatiladi.
        </div>
      )}

      {stats.accountingReconstructionGapCount > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
          {stats.accountingReconstructionGapCount} ta tarixiy shartnomada foyda taqsimotini to'liq isbotlab bo'lmadi. Ularning tushumi saqlangan,
          ammo noaniq foyda raqamlari hisobotga qo'shilmadi.
        </div>
      )}

      {rangeQuery.isError && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {rangeQuery.error instanceof Error ? rangeQuery.error.message : 'Hisobot yuklanmadi'}
        </div>
      )}

      {!rangeQuery.isError && !rangeReport && (
        <div className="rounded-lg border border-dashed border-zinc-300 bg-white px-6 py-12 text-center">
          <h2 className="text-base font-semibold text-zinc-900">Hali hisobot ma'lumoti yo'q</h2>
          <p className="mt-2 text-sm text-zinc-500">Birinchi sotuv, to'lov, nasiya yoki qaytarish yozilgach oy avtomatik paydo bo'ladi.</p>
        </div>
      )}

      {preset !== 'single' && rangeReport ? (
        <ShopRangeReportPanel report={rangeReport} currency={currency} canExport={can('EXPORT_REPORTS')} />
      ) : rangeReport ? (
        <>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card className="rounded-lg">
          <CardHeader>
            <CardDescription title="Faqat haqiqatda qabul qilingan to'lovlar (naqd sotuv va nasiya to'lovlari) — hali to'lanmagan sotuvlar bu yerga kirmaydi">
              Bu oy tushgan pul
            </CardDescription>
            <CardAction>
              <CircleDollarSign className="size-4 text-blue-600" />
            </CardAction>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-zinc-900">{fmt(collected, currency)}</div>
            <p className="mt-3 text-xs text-zinc-500">
              Shu oy haqiqatda qabul qilingan barcha to'lovlar; ochiq majburiyatlar bilan foizga aylantirilmaydi.
            </p>
          </CardContent>
        </Card>

        <Card className="rounded-lg border-emerald-200 bg-emerald-50/30">
          <CardHeader>
            <CardDescription className="text-emerald-800">Sof tushum</CardDescription>
            <CardAction>
              <WalletCards className="size-4 text-emerald-700" />
            </CardAction>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-900">{fmt(netCash, currency)}</div>
            <p className="mt-3 text-xs text-emerald-800/70">Bu oy tushgan pul minus mijozga haqiqatda qaytarilgan pul</p>
          </CardContent>
        </Card>

          <Card className="rounded-lg border-teal-200 bg-teal-50/30">
            <CardHeader>
              <CardDescription className="text-teal-800">Bu oy to&apos;lanishi kerak</CardDescription>
            <CardAction>
              <CalendarClock className="size-4 text-teal-700" />
            </CardAction>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-zinc-900">{expectedReceivablesText}</div>
            <p className="mt-3 text-xs text-zinc-500">Faqat shu oy muddati kelgan va hali to&apos;lanmagan summa; keyingi oylar kirmaydi</p>
          </CardContent>
        </Card>

        <Card className="rounded-lg border-emerald-200 bg-emerald-50/30">
          <CardHeader>
            <CardDescription className="text-emerald-800">Bu oy haqiqiy foyda</CardDescription>
            <CardAction>
              <TrendingUp className="size-4 text-emerald-600" />
            </CardAction>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-900">{fmt(grossProfit, currency)}</div>
            <p className="mt-3 text-xs text-emerald-800/70">Faqat shu oy kelib tushgan to&apos;lovlarga tegishli marja va foiz, haqiqiy reverslar hisobga olingan</p>
          </CardContent>
        </Card>

        <Card className="rounded-lg">
          <CardHeader>
            <CardDescription>Bu oy kutilayotgan foyda</CardDescription>
            <CardAction><CalendarClock className="size-4 text-violet-600" /></CardAction>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-zinc-900">{expectedText}</div>
            <p className="mt-3 text-xs text-zinc-500">Shu oy muddati kelgan, hali to&apos;lanmagan marja va foiz; kelgusi oylar kirmaydi</p>
          </CardContent>
        </Card>

        <Card className="rounded-lg">
          <CardHeader>
            <CardDescription>Nasiya foizi — tushgan</CardDescription>
            <CardAction><CircleDollarSign className="size-4 text-cyan-700" /></CardAction>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-zinc-900">{fmt(interestProfit, currency)}</div>
            <p className="mt-3 text-xs text-zinc-500">Faqat shu oy amalda to&apos;langan foiz qismi</p>
          </CardContent>
        </Card>

        <Card className="rounded-lg">
          <CardHeader>
            <CardDescription>Nasiya foizi — kutilayotgan</CardDescription>
            <CardAction><CalendarClock className="size-4 text-cyan-700" /></CardAction>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-zinc-900">{expectedInterestText}</div>
            <p className="mt-3 text-xs text-zinc-500">Shu oy to&apos;lanishi kerak, lekin hali tushmagan foiz qismi</p>
          </CardContent>
        </Card>

        <Card className="rounded-lg border-red-200 bg-red-50/50">
          <CardHeader>
            <CardDescription className="text-red-700">Muddati o'tgan qarz</CardDescription>
            <CardAction>
              <AlertTriangle className="size-4 text-red-600" />
            </CardAction>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-700">{overdueText}</div>
            <p className="mt-3 text-xs text-red-700/70">Bugun ko'rib chiqilishi kerak bo'lgan qarzdorlik · joriy kurs bo'yicha</p>
          </CardContent>
        </Card>

        <Card className="rounded-lg border-amber-200 bg-amber-50/40">
          <CardHeader>
            <CardDescription className="text-amber-900">Bizning qarzlarimiz</CardDescription>
            <CardAction><HandCoins className="size-4 text-amber-700" /></CardAction>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-950">{supplierDebtText}</div>
            <p className="mt-3 text-xs text-amber-900/70">
              {stats.supplierPayablesOpenAllTimeCount} ta ochiq qarz · barcha muddatlardagi joriy qoldiq
            </p>
          </CardContent>
        </Card>

        <Card className="rounded-lg border-blue-200 bg-blue-50/40">
          <CardHeader>
            <CardDescription className="text-blue-900">Bizga Pay Later qarzlar</CardDescription>
            <CardAction><UserRoundCheck className="size-4 text-blue-700" /></CardAction>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-950">{customerPayLaterText}</div>
            <p className="mt-3 text-xs text-blue-900/70">
              {stats.customerPayLaterOpenAllTimeCount} ta oddiy Sotuv qoldig&apos;i · barcha muddatlar, Nasiya bu raqamga kirmaydi
            </p>
          </CardContent>
        </Card>

        <Card className="rounded-lg">
          <CardHeader>
            <CardDescription>Yetkazib beruvchiga to&apos;langan</CardDescription>
            <CardAction><HandCoins className="size-4 text-zinc-500" /></CardAction>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-zinc-900">{supplierPaymentsText}</div>
            <p className="mt-3 text-xs text-zinc-500">Tanlangan oyda yozilgan {stats.supplierPaymentsMadeSelectedMonthCount} ta to&apos;lov; Sof tushum va foydadan ayrilmaydi</p>
          </CardContent>
        </Card>

        <Card className="rounded-lg">
          <CardHeader>
            <CardDescription>Mijozga qaytarilgan pul</CardDescription>
            <CardAction>
              <RotateCcw className="size-4 text-purple-600" />
            </CardAction>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-zinc-900">{fmt(refunds, currency)}</div>
            <p className="mt-3 text-xs text-zinc-500">Bu oy {stats.returnsThisMonth} ta qaytarish bo&apos;yicha haqiqatda mijozga berilgan pul</p>
          </CardContent>
        </Card>

        <Card className="rounded-lg">
          <CardHeader>
            <CardDescription>Ombordagi tannarx</CardDescription>
            <CardAction>
              <Boxes className="size-4 text-slate-500" />
            </CardAction>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-zinc-900">{fmt(inventory, currency)}</div>
            <p className="mt-3 text-xs text-zinc-500">Hali sotilmagan qurilmalarga bog'langan pul</p>
          </CardContent>
        </Card>
      </div>

      <HisobotActivityChartLoader months={rangeReport.months} currencyContext={currency} />

      {currencyTotalsComplete ? (
        <HisobotChartsLoader cashFlowData={cashFlowData} businessData={businessData} chartConfig={chartConfig} currency={currency} />
      ) : (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          USD kursi mavjud emasligi sababli aralash-valyuta diagrammasi yashirildi. Kutilayotgan: {expectedText}; kechikkan: {overdueText}.
          Hech qaysi USD va UZS summa bir-biriga xom holda qo'shilmadi.
        </div>
      )}

      {stats.returnsThisMonth > 0 && (
        <details className="rounded-lg border border-zinc-200 bg-white">
          <summary className="cursor-pointer px-5 py-4 text-sm font-semibold text-zinc-900">Qaytarishlar qanday hisoblanganini ko&apos;rish</summary>
          <div className="grid gap-3 border-t border-zinc-100 px-5 py-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
            {[
              ['Mijozga qaytarilgan pul', fmt(refunds, currency)],
              ['Oldin tan olingan foydadan bekor qilindi', fmt(reversedRevenue, currency)],
              ['Omborga qaytgan tannarx', fmt(recoveredInventoryCost, currency)],
              ['Do‘konda saqlab qolingan qiymat', fmt(retainedReturnValue, currency)],
            ].map(([label, value]) => (
              <div key={label}>
                <div className="text-xs text-zinc-500">{label}</div>
                <div className="mt-1 font-semibold text-zinc-900">{value}</div>
              </div>
            ))}
            <p className="sm:col-span-2 lg:col-span-4 text-xs text-zinc-500">
              To&apos;lanmagan bekor qilingan qarz pul qaytarilishi hisoblanmaydi va “Sof tushum”dan ayrilmaydi. Kelajakda olinmagan foyda ham revers qilinmaydi.
            </p>
          </div>
        </details>
      )}
        </>
      ) : null}
    </div>
  )
}
