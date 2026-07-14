'use client'

import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Boxes, CalendarClock, CircleDollarSign, Download, FileX2, RotateCcw, TrendingUp } from 'lucide-react'
import { Card, CardAction, CardContent, CardDescription, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import type { ChartConfig } from '@/components/ui/chart'
import type { getShopStats } from '@/lib/server/shop-stats'
import type { ShopRangeReport } from '@/lib/server/shop-report-range'
import type { ReportRangePreset } from '@/lib/report-range'
import { formatMoneyByCurrency, formatPartitionedMoney, type CurrencyContext } from '@/lib/currency'
import HisobotChartsLoader from './hisobot-charts-loader'
import HisobotFilters from './hisobot-filters'
import ShopRangeReportPanel from './shop-range-report-panel'
import { queryKeys } from '@/lib/query-keys'
import { useAuthenticatedQueryScope } from '@/components/query-scope-context'
import { useShopAccess } from '@/components/shop/shop-access-context'
import { cn } from '@/lib/utils'

type ShopStats = Awaited<ReturnType<typeof getShopStats>>
type ShopAdminOption = { id: string; name: string }
type MonthOption = { value: string; label: string }

function fmt(value: number, currency: CurrencyContext) {
  return formatMoneyByCurrency(value, currency.currency, currency.usdUzsRate)
}

function fmtBase(value: number, currency: CurrencyContext) {
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
  const grossProfit = stats.accrualGrossProfitThisMonth ?? stats.realProfitThisMonth
  const interestProfit = stats.nasiyaInterestThisMonth ?? 0
  const currencyTotalsComplete = stats.expectedThisMonthComplete && stats.overdueMoneyComplete
  const expectedText = formatPartitionedMoney({
    amountUzs: stats.expectedThisMonthUzs,
    amountUsd: stats.expectedThisMonthUsd,
    displayCurrency: currency.currency,
    rate: currency.usdUzsRate,
  })
  const overdueText = formatPartitionedMoney({
    amountUzs: stats.overdueMoneyUzs,
    amountUsd: stats.overdueMoneyUsd,
    displayCurrency: currency.currency,
    rate: currency.usdUzsRate,
  })
  const writeOffText = formatPartitionedMoney({
    amountUzs: stats.writeOffsThisMonthNativeUzs,
    amountUsd: stats.writeOffsThisMonthNativeUsd,
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
    { name: 'Kutilmoqda', amount: expected, fill: 'var(--color-expected)' },
    { name: 'Kechikkan', amount: overdue, fill: 'var(--color-overdue)' },
  ]

  const businessData = [
    { name: 'Ombor', amount: inventory, fill: 'var(--color-inventory)' },
    { name: 'Sotuv foydasi', amount: grossProfit, fill: 'var(--color-gross)' },
    {
      name: 'Nasiya foizi',
      amount: interestProfit,
      fill: 'var(--color-interest)',
    },
  ]

  const chartConfig = {
    collected: { label: 'Umumiy aylanma', color: '#2563eb' },
    net: { label: 'Sof tushum', color: '#15803d' },
    refunds: { label: 'Qaytarilgan summa', color: '#9333ea' },
    expected: { label: 'Kutilmoqda', color: '#0f766e' },
    overdue: { label: 'Kechikkan', color: '#dc2626' },
    inventory: { label: 'Ombor', color: '#64748b' },
    gross: { label: 'Sotuv foydasi', color: '#16a34a' },
    interest: { label: 'Nasiya foizi', color: '#0891b2' },
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
            Umumiy aylanma/sof tushum, qarzdorlik, ombor tannarxi va sotuv foydasi ko'rsatkichlari
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
            Pul tushumi va ochiq majburiyatlar alohida hisoblanadi
          </div>
          {preset === 'single' && rangeReport && can('EXPORT_REPORTS') && (
            <div className="flex gap-2">
              <a href={singleExportHref('csv')} className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'h-9')}>
                <Download data-icon="inline-start" /> CSV
              </a>
              <a href={singleExportHref('xlsx')} className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'h-9')}>
                <Download data-icon="inline-start" /> Excel
              </a>
            </div>
          )}
        </div>
      </div>

      {adminId && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          Admin filtri faqat u amalga oshirgan sotuv/nasiya/to'lov/qaytarish va faoliyat jurnaliga taalluqli. Ombordagi tannarx, joriy faol
          nasiyalar, kutilayotgan va kechikkan qarzdorlik — bularni bitta adminga bog'lab bo'lmaydi, shuning uchun ular barcha adminlar
          bo'yicha ko'rsatiladi.
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

        <Card className="rounded-lg border-orange-200 bg-orange-50/40">
          <CardHeader>
            <CardDescription className="text-orange-800">Hisobdan chiqarilgan qarz</CardDescription>
            <CardAction>
              <FileX2 className="size-4 text-orange-700" />
            </CardAction>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-900">{writeOffText}</div>
            <p className="mt-3 text-xs text-orange-800/70">
              Bu oy {stats.writeOffCountThisMonth} ta hisobdan chiqarish, {stats.writeOffReopenCountThisMonth} ta qayta ochish · hodisa paytidagi UZS: {fmt(stats.writeOffsThisMonthFrozenUzs, currency)}
            </p>
          </CardContent>
        </Card>

        <Card className="rounded-lg">
          <CardHeader>
            <CardDescription>Bu oy kutilmoqda</CardDescription>
            <CardAction>
              <CalendarClock className="size-4 text-teal-700" />
            </CardAction>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-zinc-900">{expectedText}</div>
            <p className="mt-3 text-xs text-zinc-500">Nasiya va qisman sotuvlardan qolgan oy ichidagi summa · joriy kurs bo'yicha</p>
          </CardContent>
        </Card>

        <Card className="rounded-lg">
          <CardHeader>
            <CardDescription>Qaytarilgan pul</CardDescription>
            <CardAction>
              <RotateCcw className="size-4 text-purple-600" />
            </CardAction>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-zinc-900">{fmt(refunds, currency)}</div>
            <p className="mt-3 text-xs text-zinc-500">
              Bu oy {stats.returnsThisMonth} ta qaytarish · sotuvdan bekor qilindi: {fmt(reversedRevenue, currency)} · saqlab qolindi:{' '}
              {fmt(retainedReturnValue, currency)}
            </p>
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

      {currencyTotalsComplete ? (
        <HisobotChartsLoader cashFlowData={cashFlowData} businessData={businessData} chartConfig={chartConfig} currency={currency} />
      ) : (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          USD kursi mavjud emasligi sababli aralash-valyuta diagrammasi yashirildi. Kutilayotgan: {expectedText}; kechikkan: {overdueText}.
          Hech qaysi USD va UZS summa bir-biriga xom holda qo'shilmadi.
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="rounded-lg">
          <CardHeader>
            <CardDescription>Sotuv foydasi</CardDescription>
            <CardAction>
              <TrendingUp className="size-4 text-emerald-600" />
            </CardAction>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-zinc-900">{fmt(grossProfit, currency)}</div>
            <p className="mt-3 text-xs text-zinc-500">
              Sotuv davridagi foyda va shu oy qaytarilgan savdolarning alohida reversali. Qaytarishda {fmt(recoveredInventoryCost, currency)}
              {' '}tannarx omborga qaytdi; eski oyning natijasi o'zgartirilmadi.
            </p>
          </CardContent>
        </Card>

        <Card className="rounded-lg">
          <CardHeader>
            <CardDescription>Qisqa xulosa</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              ["Yig'ilgan", fmtBase(collected, currency)],
              ['Kutilayotgan', expectedText],
              ['Kechikkan', overdueText],
              ['Hisobdan chiqarilgan', writeOffText],
              ['Nasiya foizi', fmt(interestProfit, currency)],
              ['Qaytarish reversali', fmt(reversedRevenue, currency)],
              ['Qaytgan tannarx', fmt(recoveredInventoryCost, currency)],
              ['Saqlab qolingan qiymat', fmt(retainedReturnValue, currency)],
              ['Ombor', fmt(inventory, currency)],
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between border-b border-zinc-100 pb-2 last:border-0 last:pb-0">
                <span className="text-sm text-zinc-500">{label}</span>
                <span className="text-sm font-semibold text-zinc-900">{value}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
        </>
      ) : null}
    </div>
  )
}
