import { redirect } from 'next/navigation'
import { requireCurrentShopPermission } from '@/lib/api-auth'
import { CUSTOMER_PROFILE_SECTIONS, type CustomerProfileSection } from '@/lib/server/customer-profile'
import { positivePage, scalarParam } from '@/lib/list-url-state'
import { CustomerProfileClient } from './customer-profile-client'

export default async function CustomerProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams?: Promise<{ section?: string | string[]; page?: string | string[] }>
}) {
  const guarded = await requireCurrentShopPermission('CUSTOMER_VIEW')
  if (!guarded.ok || !guarded.shopId) redirect('/shop/dashboard')
  const [{ id }, query] = await Promise.all([params, searchParams])
  const requested = scalarParam(query?.section)
  const section = CUSTOMER_PROFILE_SECTIONS.includes(requested as CustomerProfileSection)
    ? requested as CustomerProfileSection
    : 'devices'
  return <CustomerProfileClient customerId={id} initialSection={section} initialPage={positivePage(query?.page)} />
}
