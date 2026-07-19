import { notFound, redirect } from 'next/navigation'
import { requireCurrentShopPermission } from '@/lib/api-auth'
import {
  CUSTOMER_PROFILE_SECTIONS,
  getCustomerProfileHistory,
  getCustomerProfileOverview,
  type CustomerProfileSection,
} from '@/lib/server/customer-profile'
import { getCustomerProfileAnalytics } from '@/lib/server/customer-profile-analytics'
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
  if (!guarded.ok || !guarded.shopId || !guarded.principal) redirect('/shop/dashboard')
  const [{ id }, query] = await Promise.all([params, searchParams])
  const requested = scalarParam(query?.section)
  const requestedSection = CUSTOMER_PROFILE_SECTIONS.includes(requested as CustomerProfileSection)
    ? requested as CustomerProfileSection
    : 'devices'
  const includeOwnerFinancials = guarded.principal.memberKind === 'SHOP_OWNER'
  const section = !includeOwnerFinancials && requestedSection === 'resolutions' ? 'devices' : requestedSection
  const page = positivePage(query?.page)
  const visibility = { includeOwnerFinancials }
  const [overview, analytics, history] = await Promise.all([
    getCustomerProfileOverview({ shopId: guarded.shopId, customerId: id, visibility }),
    getCustomerProfileAnalytics({ shopId: guarded.shopId, customerId: id, months: 12, visibility }),
    getCustomerProfileHistory({ shopId: guarded.shopId, customerId: id, section, page, take: 20 }),
  ])
  if (!overview || !analytics || !history.found) notFound()

  return (
    <CustomerProfileClient
      customerId={id}
      initialOverview={overview}
      initialAnalytics={analytics}
      initialHistory={history}
      initialSection={section}
      initialPage={page}
    />
  )
}
