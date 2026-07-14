import { redirect } from 'next/navigation'
import { requireApiSession } from '@/lib/api-auth'
import { getShopOperationalStats, getShopStats } from '@/lib/server/shop-stats'
import DashboardClient from './dashboard-client'
import { latestChangeCursorForSession } from '@/lib/server/change-events'
import { IncrementalSnapshotBoundary } from '@/components/incremental-snapshot-boundary'
import { principalHasPermission } from '@/lib/server/shop-access'

export default async function DashboardPage() {
  const guarded = await requireApiSession()
  if (!guarded.ok || !guarded.shopId || !guarded.principal) redirect('/shop/login')
  const financialView = principalHasPermission(guarded.principal, 'DASHBOARD_FINANCIAL_VIEW')
  const operationalView = principalHasPermission(guarded.principal, 'DASHBOARD_OPERATIONAL_VIEW')
  if (!financialView && !operationalView) redirect('/shop/yangi-operatsiya')
  const cursor = await latestChangeCursorForSession(guarded.session)
  const stats = financialView
    ? await getShopStats(guarded.session, guarded.shopId)
    : await getShopOperationalStats(guarded.session, guarded.shopId)
  return <><IncrementalSnapshotBoundary cursor={cursor} /><DashboardClient initialStats={stats} financialView={financialView} /></>
}
