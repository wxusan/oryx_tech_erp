import { redirect } from 'next/navigation'
import { requireApiSession } from '@/lib/api-auth'
import { getShopStats } from '@/lib/server/shop-stats'
import DashboardClient from './dashboard-client'
import { latestChangeCursorForSession } from '@/lib/server/change-events'
import { IncrementalSnapshotBoundary } from '@/components/incremental-snapshot-boundary'
import Link from 'next/link'
import { principalCan, type ShopPermissionCode } from '@/lib/access-control'

const staffActions: Array<{ href: string; label: string; permission: ShopPermissionCode }> = [
  { href: '/shop/qurilmalar', label: "Qurilmalarni ko'rish", permission: 'INVENTORY_VIEW' },
  { href: '/shop/mijozlar', label: "Mijozlarni ko'rish", permission: 'CUSTOMER_VIEW' },
  { href: '/shop/nasiyalar', label: "Nasiyalarni ko'rish", permission: 'NASIYA_VIEW' },
]

export default async function DashboardPage() {
  const guarded = await requireApiSession()
  if (!guarded.ok || !guarded.shopId || !guarded.principal) redirect('/shop/login')
  if (guarded.principal.memberKind === 'SHOP_STAFF') {
    const actions = staffActions.filter((action) => principalCan(guarded.principal!, action.permission))
    const canOperate = (['INVENTORY_MANAGE', 'CASH_SALE_CREATE', 'NASIYA_CREATE', 'OLIB_MANAGE'] as const)
      .some((permission) => principalCan(guarded.principal!, permission))
    return (
      <div className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
        <div>
          <h1 className="text-xl font-bold text-zinc-900">Ish paneli</h1>
          <p className="mt-1 text-sm text-zinc-500">Sizga do&apos;kon egasi bergan operatsion ruxsatlar ko&apos;rsatilgan.</p>
        </div>
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
          Daromad, foyda, to&apos;liq hisobot, log va paket narxlari xodim profilida ko&apos;rsatilmaydi.
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {actions.map((action) => (
            <Link key={action.href} href={action.href} className="rounded-lg border border-zinc-200 bg-white p-4 font-medium text-zinc-900 transition hover:border-zinc-400 hover:shadow-sm">
              {action.label} →
            </Link>
          ))}
          {canOperate && (
            <Link href="/shop/yangi-operatsiya" className="rounded-lg border border-zinc-200 bg-white p-4 font-medium text-zinc-900 transition hover:border-zinc-400 hover:shadow-sm">
              Yangi operatsiya →
            </Link>
          )}
          <Link href="/shop/settings" className="rounded-lg border border-zinc-200 bg-white p-4 font-medium text-zinc-900 transition hover:border-zinc-400 hover:shadow-sm">
            Shaxsiy profil va parol →
          </Link>
        </div>
        {actions.length === 0 && !canOperate && <p className="text-sm text-zinc-500">Hozircha operatsion ruxsat berilmagan. Do&apos;kon egasiga murojaat qiling.</p>}
      </div>
    )
  }
  const cursor = await latestChangeCursorForSession(guarded.session)
  const stats = await getShopStats(guarded.session, guarded.shopId)
  return <><IncrementalSnapshotBoundary cursor={cursor} /><DashboardClient initialStats={stats} /></>
}
