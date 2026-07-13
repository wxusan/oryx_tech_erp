import { redirect } from 'next/navigation'
import { requireCurrentShopPermission } from '@/lib/api-auth'
import { getShopStats } from '@/lib/server/shop-stats'
import { getShopCurrencyContext } from '@/lib/server/currency'
import { recentTashkentMonthKeys, tashkentMonthRangeFromKey } from '@/lib/timezone'
import { prisma } from '@/lib/prisma'
import HisobotClient from './hisobot-client'
import { latestChangeCursorForSession } from '@/lib/server/change-events'
import { IncrementalSnapshotBoundary } from '@/components/incremental-snapshot-boundary'

const UZ_MONTHS = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun', 'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr']

function uzMonthLabelFromKey(monthKey: string) {
  const [year, month] = monthKey.split('-').map(Number)
  return `${UZ_MONTHS[(month ?? 1) - 1] ?? ''} ${year ?? ''}`.trim()
}

interface ShopReportPageProps {
  searchParams?: Promise<{ month?: string | string[]; admin?: string | string[] }>
}

export default async function ShopReportPage({ searchParams }: ShopReportPageProps) {
  const guarded = await requireCurrentShopPermission('REPORT_VIEW')
  if (!guarded.ok || !guarded.shopId) redirect('/shop/dashboard')
  const params = await searchParams
  const monthParam = Array.isArray(params?.month) ? params.month[0] : params?.month
  const adminParam = Array.isArray(params?.admin) ? params.admin[0] : params?.admin
  const monthKey = monthParam ? tashkentMonthRangeFromKey(monthParam).monthKey : null
  const adminId = adminParam?.trim() || null
  const cursor = await latestChangeCursorForSession(guarded.session)
  const [stats, currency, shopAdmins] = await Promise.all([
    getShopStats(guarded.session, guarded.shopId, { monthKey, adminId }),
    getShopCurrencyContext(guarded.shopId),
    prisma.shopAdmin.findMany({
      where: { shopId: guarded.shopId, deletedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
  ])
  const monthOptions = recentTashkentMonthKeys(12).map((key) => ({ value: key, label: uzMonthLabelFromKey(key) }))
  return (
    <>
    <IncrementalSnapshotBoundary cursor={cursor} />
    <HisobotClient
      initialStats={stats}
      currency={currency}
      shopAdmins={shopAdmins}
      monthOptions={monthOptions}
      monthKey={monthKey}
      adminId={adminId}
    />
    </>
  )
}
