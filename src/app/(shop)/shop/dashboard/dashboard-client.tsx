'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ArrowRight, CalendarClock, ClipboardList, Package, ReceiptText, TrendingUp, WalletCards } from 'lucide-react'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import type { getShopStats } from '@/lib/server/shop-stats'
import { formatMoneyByCurrency, formatPartitionedMoney, formatUserFacingMoney, type CurrencyContext } from '@/lib/currency'
import { contractScheduleOutstanding } from '@/lib/nasiya-contract'
import { uzDate, uzMonthYear } from '@/lib/dates'
import { IntentPrefetchLink } from '@/components/intent-prefetch-link'
import { queryKeys } from '@/lib/query-keys'
import { useAuthenticatedQueryScope } from '@/components/query-scope-context'
import { useShopCurrency } from '@/lib/use-shop-currency'
import { useShopAccess } from '@/components/shop/shop-access-context'

type ShopStats = Awaited<ReturnType<typeof getShopStats>>

interface UpcomingPayment {
  nasiya: {
    id: string
    contractCurrency: 'UZS' | 'USD'
    customer: { name: string }
    device: { model: string }
  }
  dueDate: string | Date
  expectedAmount: number
  paidAmount: number
  contractExpectedAmount: number
  contractPaidAmount: number
  status: string
}

function fmt(n: number, currency: CurrencyContext) {
  return formatMoneyByCurrency(n, currency.currency, currency.usdUzsRate)
}

function fmtBase(n: number, currency: CurrencyContext) {
  return formatMoneyByCurrency(n, currency.currency, currency.usdUzsRate)
}

function KoLink({ href, enabled, label = "Ko'rish" }: { href: string; enabled: boolean; label?: string }) {
  if (!enabled) return null
  return (
    <Link prefetch={false} href={href} className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-zinc-500 hover:text-zinc-900">
      {label} <ArrowRight className="size-3" />
    </Link>
  )
}

function activityLabel(action: string) {
  if (action === 'CREATE_NASIYA') return 'Nasiya yaratildi'
  if (action === 'IMPORT_NASIYA') return 'Eski nasiya import qilindi'
  if (action === 'CREATE') return "Yangi qo'shildi"
  if (action === 'PAYMENT') return "To'lov qabul qilindi"
  if (action === 'SELL') return 'Sotuv qilindi'
  if (action === 'RETURN') return 'Qaytarildi'
  if (action === 'RESTOCK') return 'Omborga qaytarildi'
  if (action === 'UPDATE_REMINDER') return "Eslatma o'zgartirildi"
  if (action === 'UPDATE') return "Ma'lumot o'zgartirildi"
  if (action === 'DELETE') return "O'chirildi"
  if (action === 'IMPORT') return 'Import qilindi'
  return action
}

function outstanding(payment: UpcomingPayment) {
  return contractScheduleOutstanding(
    Number(payment.contractExpectedAmount),
    Number(payment.contractPaidAmount),
    payment.nasiya.contractCurrency,
  )
}

function statusLabel(status: string) {
  if (status === 'OVERDUE') return "Muddati o'tgan"
  if (status === 'PARTIAL') return "Qisman to'langan"
  if (status === 'DEFERRED') return 'Kechiktirilgan'
  if (status === 'PAID') return "To'langan"
  return 'Kutilmoqda'
}

export default function DashboardClient({ initialStats, financialView }: { initialStats: ShopStats; financialView: boolean }) {
  const scope = useAuthenticatedQueryScope()
  const { currency } = useShopCurrency()
  const { can } = useShopAccess()
  const canViewInventory = can('INVENTORY_VIEW')
  const canViewSales = can('SALE_VIEW')
  const canViewNasiya = can('NASIYA_VIEW')
  const canViewReports = can('REPORT_VIEW')
  const canViewLogs = can('LOG_VIEW')
  const statsQuery = useQuery({
    queryKey: queryKeys.domain(scope, 'reports'),
    queryFn: async ({ signal }) => {
      const response = await fetch('/api/stats/shop', { signal, cache: 'no-store' })
      const json = await response.json() as { success: boolean; data?: ShopStats; error?: string }
      if (!response.ok || !json.success || !json.data) throw new Error(json.error || 'Dashboard yuklanmadi')
      return json.data
    },
    initialData: initialStats,
  })
  const stats = statsQuery.data

  const grossCashIn = stats.grossCashInThisMonth ?? stats.cashCollectedThisMonth
  const netCashFlow = stats.netCashFlowThisMonth ?? stats.netCashAfterReturnsThisMonth
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
  const overdueCard = (
    <Card className="rounded-lg border-red-200 bg-red-50/40 transition-colors hover:border-red-300 hover:bg-red-50">
      <CardHeader>
        <CardDescription className="text-red-700">Kechikkan to&apos;lovlar</CardDescription>
        <CardAction><AlertTriangle className="size-4 text-red-500" /></CardAction>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold text-red-700">{overdueText}</div>
        <p className="mt-2 text-xs text-red-700/70">{stats.overdueCount} ta muddatdan o&apos;tgan yozuv · joriy kurs bo&apos;yicha</p>
      </CardContent>
    </Card>
  )

  return (
    <div className="p-6 space-y-6 max-w-7xl">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-zinc-900">Boshqaruv paneli</h1>
          <p className="text-sm text-zinc-500 mt-0.5">{financialView ? "Pul oqimi va ish holati" : "Qurilmalar, sotuvlar va ish holati"}</p>
        </div>
        <Badge variant="outline" className="h-6 w-fit rounded-md border-zinc-200 text-zinc-600">
          {uzMonthYear(new Date())} · {currency.currency}
        </Badge>
      </div>

      {financialView && <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <Card className="rounded-lg lg:col-span-5">
          <CardHeader className="border-b border-zinc-100">
            <CardTitle>Bu oy pul oqimi</CardTitle>
            <CardDescription>Umumiy aylanma, sof tushum va kutilayotgan to'lov</CardDescription>
            <CardAction>
              <WalletCards className="size-5 text-zinc-400" />
            </CardAction>
          </CardHeader>
          <CardContent className="space-y-5">
            <div>
              <div
                className="text-xs font-medium uppercase text-zinc-500"
                title="Faqat haqiqatda qabul qilingan to'lovlar (naqd sotuv va nasiya to'lovlari) — hali to'lanmagan sotuvlar bu yerga kirmaydi"
              >
                Umumiy aylanma
              </div>
              <div className="mt-1 text-3xl font-bold tracking-tight text-zinc-900">{fmt(grossCashIn, currency)}</div>
              <div className="mt-1 text-xs text-zinc-500">
                Sof tushum: {fmtBase(netCashFlow, currency)} · qaytarishlar ayirilgan, qabul qilingan pul
              </div>
            </div>
            <div className="rounded-md bg-zinc-50 px-3 py-2">
              <div className="flex items-center justify-between gap-3 text-xs text-zinc-500">
                <span>Shu oy hali kutilmoqda</span>
                <span className="font-semibold text-zinc-800">{expectedText}</span>
              </div>
              <p className="mt-1 text-xs text-zinc-500">
                Qabul qilingan pul va ochiq majburiyatlar alohida ko'rsatiladi; ular turli shartnoma davrlaridan bo'lishi mumkin.
              </p>
            </div>
            <KoLink href="/shop/hisobot" enabled={canViewReports} />
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:col-span-7">
          <Card className="rounded-lg">
            <CardHeader>
              <CardDescription>Sotuv foydasi</CardDescription>
              <CardAction>
                <TrendingUp className="size-4 text-zinc-400" />
              </CardAction>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-zinc-900">{fmt(stats.accrualGrossProfitThisMonth, currency)}</div>
              <p className="mt-2 text-xs text-zinc-500">
                Sotuv narxidan tannarx ayiriladi
                {stats.nasiyaInterestThisMonth > 0 ? ` · Nasiya foizi: ${fmt(stats.nasiyaInterestThisMonth, currency)}` : ''}
              </p>
              <KoLink href="/shop/hisobot" enabled={canViewReports} />
            </CardContent>
          </Card>

          <Card className="rounded-lg">
            <CardHeader>
              <CardDescription>Ombordagi tannarx</CardDescription>
              <CardAction>
                <Package className="size-4 text-zinc-400" />
              </CardAction>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-zinc-900">{fmt(stats.inventoryPurchaseCost, currency)}</div>
              <p className="mt-2 text-xs text-zinc-500">Omborda turgan qurilmalar tannarxi</p>
              <KoLink href="/shop/qurilmalar?status=IN_STOCK" enabled={canViewInventory} />
            </CardContent>
          </Card>

          {canViewNasiya
            ? <Link prefetch={false} href="/shop/nasiyalar?status=OVERDUE" className="block">{overdueCard}</Link>
            : overdueCard}
        </div>
      </div>}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card className="rounded-lg" size="sm">
          <CardContent>
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs text-zinc-500">Jami qurilmalar</div>
                <div className="mt-1 text-xl font-bold text-zinc-900">{stats.totalDevices}</div>
              </div>
              <Package className="size-5 text-zinc-400" />
            </div>
            <KoLink href="/shop/qurilmalar" enabled={canViewInventory} />
          </CardContent>
        </Card>
        <Card className="rounded-lg" size="sm">
          <CardContent>
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs text-zinc-500">Sotuvlar</div>
                <div className="mt-1 text-xl font-bold text-zinc-900">{stats.soldThisMonth}</div>
              </div>
              <ReceiptText className="size-5 text-zinc-400" />
            </div>
            <KoLink href="/shop/sotuvlar" enabled={canViewSales} />
          </CardContent>
        </Card>
        <Card className="rounded-lg" size="sm">
          <CardContent>
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs text-zinc-500">Faol nasiyalar</div>
                <div className="mt-1 text-xl font-bold text-zinc-900">{stats.activeNasiyalar}</div>
              </div>
              <ClipboardList className="size-5 text-zinc-400" />
            </div>
            <KoLink href="/shop/nasiyalar?status=ACTIVE" enabled={canViewNasiya} />
          </CardContent>
        </Card>
        <Card className="rounded-lg" size="sm">
          <CardContent>
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs text-zinc-500">{financialView ? 'Bu oy kutilmoqda' : "Muddati o'tgan"}</div>
                <div className="mt-1 text-xl font-bold text-zinc-900">{financialView ? expectedText : stats.overdueCount}</div>
              </div>
              <CalendarClock className="size-5 text-zinc-400" />
            </div>
            <KoLink href="/shop/nasiyalar" enabled={canViewNasiya} />
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="rounded-lg">
          <CardHeader className="border-b border-zinc-100">
            <CardTitle>Yaqin to'lov sanalari</CardTitle>
            <CardDescription>Nasiya bo'yicha eng yaqin va kechikkan oyliklar</CardDescription>
            {canViewNasiya && <CardAction>
              <Link prefetch={false} href="/shop/nasiyalar" className="inline-flex items-center gap-1 text-xs font-medium text-zinc-500 hover:text-zinc-900">
                Barchasini ko'rish <ArrowRight className="size-3" />
              </Link>
            </CardAction>}
          </CardHeader>
          <CardContent className="space-y-2">
            {stats.upcomingPayments.length > 0 ? (
              stats.upcomingPayments.map((p, i) => {
                const content = <>
                  <div>
                    <div className="text-sm font-medium text-zinc-900">{p.nasiya.customer.name}</div>
                    <div className="mt-0.5 text-xs text-zinc-500">
                      {p.nasiya.device.model} · {uzDate(p.dueDate)}
                    </div>
                    <Badge variant="outline" className="mt-2 rounded-md border-zinc-200 text-zinc-500">
                      {statusLabel(p.status)}
                    </Badge>
                  </div>
                  {financialView && <div className="text-right">
                    <div className="text-sm font-semibold text-zinc-900">
                      {formatUserFacingMoney({
                        amount: outstanding(p),
                        amountCurrency: p.nasiya.contractCurrency,
                        displayCurrency: currency.currency,
                        rate: currency.usdUzsRate,
                      })}
                    </div>
                    <div className="mt-0.5 text-xs text-zinc-400">qolgan</div>
                  </div>}
                </>
                const className = "flex items-center justify-between gap-3 border-b border-zinc-100 px-2 py-3 last:border-0"
                return canViewNasiya ? (
                  <IntentPrefetchLink key={i} href={`/shop/nasiyalar/${p.nasiya.id}`} className={`${className} -mx-2 rounded transition-colors hover:bg-zinc-50`}>
                    {content}
                  </IntentPrefetchLink>
                ) : <div key={i} className={className}>{content}</div>
              })
            ) : (
              <div className="text-sm text-zinc-400 py-4 text-center">To'lovlar yo'q</div>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-lg">
          <CardHeader className="border-b border-zinc-100">
            <CardTitle>Oxirgi operatsiyalar</CardTitle>
            <CardDescription>Do'kon ichidagi oxirgi harakatlar</CardDescription>
            {canViewLogs && <CardAction>
              <Link prefetch={false} href="/shop/logs" className="inline-flex items-center gap-1 text-xs font-medium text-zinc-500 hover:text-zinc-900">
                Barchasini ko'rish <ArrowRight className="size-3" />
              </Link>
            </CardAction>}
          </CardHeader>
          <CardContent className="space-y-2">
            {stats.recentActivity.length > 0 ? (
              stats.recentActivity.map((a, i) => (
                <div key={i} className="flex items-center justify-between py-2 border-b border-zinc-100 last:border-0">
                  <div className="text-sm text-zinc-700">{activityLabel(a.action)}</div>
                  <div className="text-xs text-zinc-400 ml-4 whitespace-nowrap">{uzDate(a.createdAt)}</div>
                </div>
              ))
            ) : (
              <div className="text-sm text-zinc-400 py-4 text-center">Operatsiyalar yo'q</div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
