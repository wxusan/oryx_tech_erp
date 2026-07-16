import { redirect } from 'next/navigation'
import { requireCurrentShopAnyPermission } from '@/lib/api-auth'
import { positivePage } from '@/lib/list-url-state'
import CustomersClient from './customers-client'
import { getCustomerList, scopeCustomerList } from '@/lib/server/customer-list'
import { principalHasPermission } from '@/lib/server/shop-access'

export default async function CustomersPage({
  searchParams,
}: {
  searchParams?: Promise<{ page?: string | string[] }>
}) {
  const guarded = await requireCurrentShopAnyPermission([
    'CUSTOMER_VIEW',
    'CUSTOMER_CREATE',
    'CUSTOMER_EDIT',
    'CUSTOMER_PASSPORT_PHOTO_VIEW',
    'CUSTOMER_PASSPORT_REVEAL',
    'CUSTOMER_PASSPORT_MANAGE',
    'CUSTOMER_TRUST_OVERRIDE',
  ])
  if (!guarded.ok || !guarded.shopId || !guarded.principal) redirect('/shop/dashboard')
  const params = await searchParams
  const page = positivePage(params?.page)
  const take = 25
  const data = await getCustomerList({
    shopId: guarded.shopId,
    skip: (page - 1) * take,
    take,
  })
  const initialData = scopeCustomerList(data, {
    canViewCustomers: principalHasPermission(guarded.principal, 'CUSTOMER_VIEW'),
    canEditCustomer: principalHasPermission(guarded.principal, 'CUSTOMER_EDIT'),
    canUsePassport: [
      'CUSTOMER_PASSPORT_PHOTO_VIEW',
      'CUSTOMER_PASSPORT_REVEAL',
      'CUSTOMER_PASSPORT_MANAGE',
    ].some((permission) => principalHasPermission(
      guarded.principal!,
      permission as 'CUSTOMER_PASSPORT_PHOTO_VIEW' | 'CUSTOMER_PASSPORT_REVEAL' | 'CUSTOMER_PASSPORT_MANAGE',
    )),
    canOverrideTrust: principalHasPermission(guarded.principal, 'CUSTOMER_TRUST_OVERRIDE'),
  })
  return (
    <CustomersClient
      initialPage={page}
      initialData={initialData}
    />
  )
}
