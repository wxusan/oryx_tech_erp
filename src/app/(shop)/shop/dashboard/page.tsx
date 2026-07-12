import { redirect } from 'next/navigation'
import { requireApiSession } from '@/lib/api-auth'
import { getShopStats } from '@/lib/server/shop-stats'
import DashboardClient from './dashboard-client'
import { latestChangeCursorForSession } from '@/lib/server/change-events'
import { IncrementalSnapshotBoundary } from '@/components/incremental-snapshot-boundary'

export default async function DashboardPage() {
  const guarded = await requireApiSession()
  if (!guarded.ok || !guarded.shopId) redirect('/shop/login')
  const cursor = await latestChangeCursorForSession(guarded.session)
  const stats = await getShopStats(guarded.session, guarded.shopId)
  return <><IncrementalSnapshotBoundary cursor={cursor} /><DashboardClient initialStats={stats} /></>
}
