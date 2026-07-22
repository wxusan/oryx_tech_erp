'use client'

import { AlertTriangle, Banknote, CalendarClock, CircleDollarSign, FileText, HandCoins, ReceiptText, RotateCcw, TrendingUp } from 'lucide-react'
import { formatMoneyByCurrency } from '@/lib/currency'
import { totalDueBuckets, type CustomerProfileAnalytics, type CustomerProfileNativeMoney } from '@/lib/customer-profile-analytics'
import type { CustomerProfileOverview } from '@/lib/server/customer-profile'
import { useShopCurrency } from '@/lib/use-shop-currency'
import { cn } from '@/lib/utils'
import { nativeMoneyLabel } from './customer-profile-format'

function totalDebt(analytics: CustomerProfileAnalytics): CustomerProfileNativeMoney {
  return {
    UZS: totalDueBuckets(analytics.obligations.UZS),
    USD: totalDueBuckets(analytics.obligations.USD),
  }
}

interface MetricCard {
  label: string
  value: string
  hint: string
  icon: typeof FileText
  tone?: 'default' | 'danger' | 'warning' | 'positive'
}

function Metric({ card, prominent = false }: { card: MetricCard; prominent?: boolean }) {
  const Icon = card.icon
  return (
    <div className={cn(
      'min-w-0 rounded-xl border bg-white p-3 shadow-sm sm:p-4',
      card.tone === 'danger' && 'border-red-200 bg-red-50/60',
      card.tone === 'warning' && 'border-amber-200 bg-amber-50/60',
      card.tone === 'positive' && 'border-emerald-200 bg-emerald-50/60',
      (!card.tone || card.tone === 'default') && 'border-zinc-200',
    )}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">{card.label}</p>
        <Icon className="size-4 shrink-0 text-zinc-400" aria-hidden="true" />
      </div>
      <p className={cn('mt-2 break-words font-bold tracking-tight text-zinc-950', prominent ? 'text-lg sm:text-xl' : 'text-base')}>
        {card.value}
      </p>
      <p className="mt-1 text-[11px] leading-4 text-zinc-500">{card.hint}</p>
    </div>
  )
}

export function CustomerProfileMetrics({
  overview,
  analytics,
}: {
  overview: CustomerProfileOverview
  analytics: CustomerProfileAnalytics
}) {
  const { currency } = useShopCurrency()
  const owner = analytics.visibility === 'OWNER_FINANCIAL'
  const debt = totalDebt(analytics)
  const primary: MetricCard[] = [
    { label: 'Shartnomalar', value: nativeMoneyLabel(overview.metrics.contractValue), hint: 'Barcha savdo va nasiya qiymati', icon: FileText },
    ...(owner && overview.metrics.cashCollected
      ? [{ label: 'Jami tushgan', value: nativeMoneyLabel(overview.metrics.cashCollected), hint: 'Tasdiqlangan to‘lovlar', icon: HandCoins, tone: 'positive' as const }]
      : []),
    { label: 'Joriy qarz', value: nativeMoneyLabel(debt), hint: 'Hozir ochiq majburiyatlar', icon: CircleDollarSign, tone: totalDueBuckets(analytics.obligations.UZS) + totalDueBuckets(analytics.obligations.USD) > 0 ? 'warning' : 'default' },
    { label: 'Muddati o‘tgan', value: nativeMoneyLabel(overview.metrics.overdue), hint: 'Bugundan oldingi ochiq qarz', icon: AlertTriangle, tone: overview.metrics.overdue.UZS || overview.metrics.overdue.USD ? 'danger' : 'default' },
    ...(!owner ? [{ label: 'Bu oy to‘lashi kutilmoqda', value: nativeMoneyLabel(overview.metrics.dueThisMonth), hint: 'Shu oy muddati kelgan ochiq qoldiq; oy boshidan kechikkanlari ham kiradi', icon: CalendarClock }] : []),
  ]
  const secondary: MetricCard[] = owner ? [
    { label: 'Bu oy to‘lashi kutilmoqda', value: nativeMoneyLabel(overview.metrics.dueThisMonth), hint: 'Shu oy muddati kelgan ochiq qoldiq; oy boshidan kechikkanlari ham kiradi', icon: CalendarClock },
    ...(overview.metrics.refunds ? [{ label: 'Qaytarilgan pul', value: nativeMoneyLabel(overview.metrics.refunds), hint: 'Qaytarish dalolatnomalari', icon: RotateCcw }] : []),
    ...(overview.metrics.writeOffs ? [{ label: 'Hisobdan chiqarilgan', value: nativeMoneyLabel(overview.metrics.writeOffs), hint: 'Qayta ochishlar ayirilgan', icon: ReceiptText }] : []),
    ...(overview.metrics.waivedNasiyaProfit ? [{ label: 'Kechilgan nasiya foydasi', value: nativeMoneyLabel(overview.metrics.waivedNasiyaProfit), hint: 'Muddatidan oldin yopish kelishuvlari', icon: HandCoins }] : []),
    ...(overview.metrics.accountingAccrualGrossProfitUzs != null ? [{
      label: 'Yalpi foyda',
      value: formatMoneyByCurrency(overview.metrics.accountingAccrualGrossProfitUzs, currency.currency, currency.usdUzsRate),
      hint: 'Hisob siyosati bo‘yicha hisoblangan',
      icon: TrendingUp,
    }] : []),
    ...(overview.metrics.nasiyaInterestUzs != null ? [{
      label: 'Nasiya foizi',
      value: formatMoneyByCurrency(overview.metrics.nasiyaInterestUzs, currency.currency, currency.usdUzsRate),
      hint: 'Faol hisob siyosati bo‘yicha',
      icon: Banknote,
    }] : []),
  ] : []

  return (
    <section aria-labelledby="customer-metrics-title" className="space-y-3">
      <div>
        <h2 id="customer-metrics-title" className="text-base font-semibold text-zinc-950">Asosiy ko‘rsatkichlar</h2>
        <p className="mt-0.5 text-xs text-zinc-500">UZS va USD hech qachon bitta jami qiymatga qo‘shilmaydi.</p>
      </div>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4 lg:gap-3">
        {primary.map((card) => <Metric key={card.label} card={card} prominent />)}
      </div>
      {secondary.length > 0 && (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-5">
          {secondary.map((card) => <Metric key={card.label} card={card} />)}
        </div>
      )}
    </section>
  )
}
