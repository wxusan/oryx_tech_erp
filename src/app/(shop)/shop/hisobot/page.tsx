import { redirect } from 'next/navigation'
import { requireCurrentShopFeature, requireCurrentShopPermission } from '@/lib/api-auth'
import { getShopStats } from '@/lib/server/shop-stats'
import { getShopCurrencyContext } from '@/lib/server/currency'
import { tashkentMonthRange } from '@/lib/timezone'
import { prisma } from '@/lib/prisma'
import HisobotClient from './hisobot-client'
import { latestChangeCursorForSession } from '@/lib/server/change-events'
import { IncrementalSnapshotBoundary } from '@/components/incremental-snapshot-boundary'
import { resolveReportRange, type ReportRangePreset } from '@/lib/report-range'
import { getShopRangeReport, getShopReportDataMonths } from '@/lib/server/shop-report-range'

const UZ_MONTHS = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun', 'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr']

function uzMonthLabelFromKey(monthKey: string) {
  const [year, month] = monthKey.split('-').map(Number)
  return `${UZ_MONTHS[(month ?? 1) - 1] ?? ''} ${year ?? ''}`.trim()
}

interface ShopReportPageProps {
  searchParams?: Promise<{
    preset?: string | string[]
    month?: string | string[]
    startMonth?: string | string[]
    endMonth?: string | string[]
    admin?: string | string[]
  }>
}

const REPORT_PRESETS = new Set<ReportRangePreset>(['single', 'trailing3', 'trailing6', 'trailing12', 'custom'])

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

export default async function ShopReportPage({ searchParams }: ShopReportPageProps) {
  const [guarded, featureGuard] = await Promise.all([
    requireCurrentShopPermission('REPORT_VIEW'),
    requireCurrentShopFeature('REPORTS'),
  ])
  if (!guarded.ok || !featureGuard.ok || !guarded.shopId) redirect('/shop/dashboard')
  const params = await searchParams
  const requestedPreset = first(params?.preset)
  const preset: ReportRangePreset = REPORT_PRESETS.has(requestedPreset as ReportRangePreset)
    ? requestedPreset as ReportRangePreset
    : 'single'
  const monthParam = first(params?.month)
  const startMonthParam = first(params?.startMonth)
  const endMonthParam = first(params?.endMonth)
  const adminParam = first(params?.admin)
  const adminId = adminParam?.trim() || null
  const availableMonths = await getShopReportDataMonths(guarded.shopId)
  const defaultEndMonth = availableMonths[0] ?? tashkentMonthRange().monthKey
  let range
  try {
    range = resolveReportRange({
      preset,
      month: preset === 'single' && monthParam && availableMonths.includes(monthParam) ? monthParam : null,
      startMonth: startMonthParam,
      endMonth: endMonthParam,
      defaultEndMonth,
    })
  } catch {
    range = resolveReportRange({ preset: 'single', month: availableMonths[0] ?? null, defaultEndMonth })
  }
  if (!range.monthKeys.every((monthKey) => availableMonths.includes(monthKey))) {
    range = resolveReportRange({ preset: 'single', month: availableMonths[0] ?? null, defaultEndMonth })
  }
  const monthKey = range.endMonth
  const cursor = await latestChangeCursorForSession(guarded.session)
  const [stats, currency, shopAdmins, rangeReport] = await Promise.all([
    getShopStats(guarded.session, guarded.shopId, { monthKey, adminId }),
    getShopCurrencyContext(guarded.shopId),
    prisma.shopAdmin.findMany({
      where: { shopId: guarded.shopId, deletedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    availableMonths.length || preset !== 'single' || Boolean(monthParam)
      ? getShopRangeReport({ shopId: guarded.shopId, range, adminId })
      : Promise.resolve(null),
  ])
  const monthOptions = availableMonths.map((key) => ({ value: key, label: uzMonthLabelFromKey(key) }))
  return (
    <>
    <IncrementalSnapshotBoundary cursor={cursor} />
    <HisobotClient
      initialStats={stats}
      currency={currency}
      shopAdmins={shopAdmins}
      monthOptions={monthOptions}
      initialRangeReport={rangeReport}
      preset={range.preset}
      startMonth={range.startMonth}
      endMonth={range.endMonth}
      monthKey={range.preset === 'single' ? range.startMonth : null}
      adminId={adminId}
    />
    </>
  )
}
