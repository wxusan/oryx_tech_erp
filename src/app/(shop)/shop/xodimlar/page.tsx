import { notFound } from 'next/navigation'
import { requireCurrentShopAnyPermission } from '@/lib/api-auth'
import { StaffManagement } from '@/components/shop/staff-management'

export default async function StaffPage() {
  const guarded = await requireCurrentShopAnyPermission([
    'STAFF_VIEW',
    'STAFF_CREATE',
    'STAFF_EDIT_PROFILE',
    'STAFF_RESET_PASSWORD',
    'STAFF_STATUS_MANAGE',
    'STAFF_DELETE',
    'STAFF_PERMISSION_MANAGE',
    'STAFF_NOTIFICATION_MANAGE',
  ])
  if (!guarded.ok) notFound()

  return <StaffManagement />
}
