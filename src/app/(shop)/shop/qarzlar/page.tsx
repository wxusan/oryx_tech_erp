import { redirect } from 'next/navigation'
import { requireCurrentShopAnyPermission } from '@/lib/api-auth'
import { principalHasFeature, principalHasPermission } from '@/lib/server/shop-access'
import { queryDebts, type DebtStatusFilter, type DebtTab } from '@/lib/server/debts'
import QarzlarClient from './qarzlar-client'

function scalar(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value
}

export default async function QarzlarPage({
  searchParams,
}: {
  searchParams?: Promise<{ tab?: string | string[]; month?: string | string[]; status?: string | string[] }>
}) {
  const guarded = await requireCurrentShopAnyPermission([
    'SUPPLIER_PAYABLE_VIEW', 'SUPPLIER_PAYMENT_RECORD', 'SUPPLIER_PAYMENT_MARK_PAID',
    'RECEIVABLES_VIEW', 'SALE_VIEW', 'SALE_PAYMENT_RECEIVE',
  ])
  if (!guarded.ok || !guarded.shopId || !guarded.principal) redirect('/shop/dashboard')
  const canOutgoing = principalHasFeature(guarded.principal, 'INVENTORY') &&
    ['SUPPLIER_PAYABLE_VIEW', 'SUPPLIER_PAYMENT_RECORD', 'SUPPLIER_PAYMENT_MARK_PAID'].some((permission) =>
      principalHasPermission(guarded.principal!, permission as 'SUPPLIER_PAYABLE_VIEW' | 'SUPPLIER_PAYMENT_RECORD' | 'SUPPLIER_PAYMENT_MARK_PAID'),
    )
  const canIncoming = principalHasFeature(guarded.principal, 'CASH_SALES') &&
    ['RECEIVABLES_VIEW', 'SALE_VIEW', 'SALE_PAYMENT_RECEIVE'].some((permission) =>
      principalHasPermission(guarded.principal!, permission as 'RECEIVABLES_VIEW' | 'SALE_VIEW' | 'SALE_PAYMENT_RECEIVE'),
    )
  if (!canOutgoing && !canIncoming) redirect('/shop/dashboard')
  const params = await searchParams
  const requestedTab = scalar(params?.tab)
  const tab: DebtTab = requestedTab === 'incoming' && canIncoming
    ? 'incoming'
    : requestedTab === 'outgoing' && canOutgoing
      ? 'outgoing'
      : canOutgoing ? 'outgoing' : 'incoming'
  const rawMonth = scalar(params?.month)
  const month = rawMonth === 'ALL' || /^\d{4}-(0[1-9]|1[0-2])$/.test(rawMonth ?? '') ? rawMonth! : 'ALL'
  const rawStatus = scalar(params?.status)?.toUpperCase()
  const status: DebtStatusFilter = ['ALL', 'PENDING', 'PARTIAL', 'OVERDUE'].includes(rawStatus ?? '')
    ? rawStatus as DebtStatusFilter
    : 'ALL'
  const initialData = await queryDebts(guarded.shopId, { tab, month, status, take: 18 })
  return (
    <QarzlarClient
      initialData={initialData}
      initialTab={tab}
      initialMonth={month}
      initialStatus={status}
      canOutgoing={canOutgoing}
      canIncoming={canIncoming}
      canPayOutgoing={principalHasPermission(guarded.principal, 'SUPPLIER_PAYMENT_RECORD') || principalHasPermission(guarded.principal, 'SUPPLIER_PAYMENT_MARK_PAID')}
      canReceiveIncoming={principalHasPermission(guarded.principal, 'SALE_PAYMENT_RECEIVE')}
      canViewDevice={principalHasPermission(guarded.principal, 'INVENTORY_VIEW')}
      canOpenPayableDevice={canOutgoing}
      canViewCustomer={principalHasPermission(guarded.principal, 'CUSTOMER_VIEW')}
    />
  )
}
