import { redirect } from 'next/navigation'
import { requireCurrentShopAnyPermission } from '@/lib/api-auth'
import { getShopDevicesList } from '@/lib/server/shop-lists'
import { getShopCurrencyContext } from '@/lib/server/currency'
import QurilmalarClient from './qurilmalar-client'
import { positivePage, scalarParam } from '@/lib/list-url-state'
import { latestChangeCursorForSession } from '@/lib/server/change-events'
import { principalHasPermission } from '@/lib/server/shop-access'
import DeviceActionQueue from './device-action-queue'

interface QurilmalarPageProps {
  searchParams?: Promise<{ tab?: string | string[]; focus?: string | string[]; status?: string | string[]; q?: string | string[]; page?: string | string[] }>
}

// Matches PER_PAGE in qurilmalar-client.tsx (first page is server-rendered
// here for a fast initial paint with no loading flash; every subsequent
// page/search/status change is a client-side fetch to /api/devices?paginated=1).
const PER_PAGE = 25

export default async function QurilmalarPage({ searchParams }: QurilmalarPageProps) {
  const guarded = await requireCurrentShopAnyPermission(['INVENTORY_VIEW', 'DEVICE_EDIT', 'DEVICE_DELETE', 'DEVICE_RESTOCK', 'SALE_RETURN_REFUND'])
  if (!guarded.ok || !guarded.shopId) redirect('/shop/dashboard')
  if (!guarded.principal || !principalHasPermission(guarded.principal, 'INVENTORY_VIEW')) {
    return <DeviceActionQueue />
  }

  const params = await searchParams
  const tab = Array.isArray(params?.tab) ? params?.tab[0] : params?.tab
  const focus = Array.isArray(params?.focus) ? params?.focus[0] : params?.focus
  const status = tab?.toLowerCase() === 'qarz'
    ? 'SOLD_DEBT'
    : (Array.isArray(params?.status) ? params?.status[0] : params?.status)
  const initialSearch = scalarParam(params?.q).slice(0, 100)
  const initialPage = positivePage(params?.page)
  const validStatuses = ['IN_STOCK', 'SOLD_CASH', 'SOLD_DEBT', 'SOLD_NASIYA', 'RETURNED'] as const
  const initialStatus = validStatuses.includes(status as (typeof validStatuses)[number])
    ? (status as (typeof validStatuses)[number])
    : 'Barchasi'

  const snapshotCursor = await latestChangeCursorForSession(guarded.session)
  const [{ items: devices, total }, currency] = await Promise.all([
    getShopDevicesList(guarded.shopId, {
      status: initialStatus === 'Barchasi' ? undefined : initialStatus,
      search: initialSearch || undefined,
      skip: (initialPage - 1) * PER_PAGE,
      take: PER_PAGE,
    }, { includeOwnerFinancials: guarded.principal?.memberKind === 'SHOP_OWNER' }),
    getShopCurrencyContext(guarded.shopId),
  ])

  return (
    <QurilmalarClient
      initialDevices={devices}
      initialTotal={total}
      currency={currency}
      initialStatus={initialStatus}
      initialDebtFocus={focus === 'OVERDUE' || focus === 'DUE_TODAY' ? focus : undefined}
      initialSearch={initialSearch}
      initialPage={initialPage}
      initialSyncCursor={snapshotCursor}
    />
  )
}
