import { redirect } from 'next/navigation'
import { requireCurrentShopAnyPermission } from '@/lib/api-auth'
import { positivePage } from '@/lib/list-url-state'
import CustomersClient from './customers-client'

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
  if (!guarded.ok || !guarded.shopId) redirect('/shop/dashboard')
  const params = await searchParams
  return (
    <CustomersClient
      initialPage={positivePage(params?.page)}
    />
  )
}
