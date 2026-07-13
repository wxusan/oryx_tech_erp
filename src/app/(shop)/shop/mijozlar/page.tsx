import { redirect } from 'next/navigation'
import { requireCurrentShopPermission } from '@/lib/api-auth'
import { positivePage, scalarParam } from '@/lib/list-url-state'
import CustomersClient from './customers-client'

export default async function CustomersPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string | string[]; page?: string | string[] }>
}) {
  const guarded = await requireCurrentShopPermission('CUSTOMER_VIEW')
  if (!guarded.ok || !guarded.shopId) redirect('/shop/dashboard')
  const params = await searchParams
  return (
    <CustomersClient
      initialSearch={scalarParam(params?.q).slice(0, 100)}
      initialPage={positivePage(params?.page)}
    />
  )
}
