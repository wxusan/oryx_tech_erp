import { redirect } from 'next/navigation'
import { requireApiSession } from '@/lib/api-auth'
import { principalHasPermission } from '@/lib/server/shop-access'
import type { ShopPermissionCode } from '@/lib/access-control'

/**
 * The shop root is role-aware on the server so a worker never briefly loads
 * an owner dashboard during login or direct navigation.
 */
export default async function ShopLandingPage() {
  const guarded = await requireApiSession()
  if (!guarded.ok || !guarded.principal) redirect('/shop/login')

  const destinations: Array<{ href: string; permissions: ShopPermissionCode[] }> = [
    { href: '/shop/dashboard', permissions: ['DASHBOARD_OPERATIONAL_VIEW', 'DASHBOARD_FINANCIAL_VIEW'] },
    { href: '/shop/yangi-operatsiya', permissions: ['DEVICE_CREATE', 'SALE_CREATE', 'NASIYA_CREATE', 'OLIB_CREATE', 'SALE_PAYMENT_RECEIVE', 'NASIYA_PAYMENT_RECEIVE'] },
    { href: '/shop/qurilmalar', permissions: ['INVENTORY_VIEW', 'DEVICE_EDIT', 'DEVICE_DELETE', 'DEVICE_RESTOCK', 'SALE_RETURN_REFUND', 'NASIYA_CANCEL'] },
    { href: '/shop/sotuvlar', permissions: ['SALE_VIEW', 'SALE_EDIT', 'SALE_REMINDER_MANAGE'] },
    { href: '/shop/nasiyalar', permissions: ['NASIYA_VIEW', 'NASIYA_EDIT', 'NASIYA_REMINDER_MANAGE', 'NASIYA_ARCHIVE', 'NASIYA_REOPEN'] },
    { href: '/shop/tolovlar', permissions: ['RECEIVABLES_VIEW', 'SALE_VIEW', 'SALE_PAYMENT_RECEIVE', 'NASIYA_VIEW', 'NASIYA_PAYMENT_RECEIVE', 'NASIYA_DEFER'] },
    { href: '/shop/mijozlar', permissions: ['CUSTOMER_VIEW', 'CUSTOMER_CREATE', 'CUSTOMER_EDIT', 'CUSTOMER_PASSPORT_PHOTO_VIEW', 'CUSTOMER_PASSPORT_REVEAL', 'CUSTOMER_PASSPORT_MANAGE', 'CUSTOMER_TRUST_OVERRIDE'] },
    { href: '/shop/olib-sotdim', permissions: ['OLIB_VIEW', 'SUPPLIER_PAYMENT_MARK_PAID'] },
    { href: '/shop/hisobot', permissions: ['REPORT_VIEW'] },
    { href: '/shop/logs', permissions: ['LOG_VIEW'] },
    { href: '/shop/import', permissions: ['IMPORT_CUSTOMERS', 'IMPORT_OLD_NASIYA'] },
    { href: '/shop/eksport', permissions: ['EXPORT_DEVICES', 'EXPORT_CUSTOMERS', 'EXPORT_SALES', 'EXPORT_NASIYA', 'EXPORT_OLIB', 'EXPORT_RETURNS', 'EXPORT_LOGS', 'EXPORT_REPORTS'] },
    { href: '/shop/xodimlar', permissions: ['STAFF_VIEW', 'STAFF_CREATE', 'STAFF_EDIT_PROFILE', 'STAFF_RESET_PASSWORD', 'STAFF_STATUS_MANAGE', 'STAFF_DELETE', 'STAFF_PERMISSION_MANAGE', 'STAFF_NOTIFICATION_MANAGE'] },
  ]
  const destination = destinations.find((item) => (
    item.permissions.some((permission) => principalHasPermission(guarded.principal!, permission))
  ))
  redirect(destination?.href ?? '/shop/settings')
}
