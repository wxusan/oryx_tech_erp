import { notFound } from 'next/navigation'
import { requireCurrentShopPermission } from '@/lib/api-auth'
import { StaffManagement } from '@/components/shop/staff-management'

export default async function StaffPage() {
  const guarded = await requireCurrentShopPermission('MEMBER_MANAGE')
  if (!guarded.ok) notFound()

  return <StaffManagement />
}
