import { notFound } from 'next/navigation'
import { requireCurrentShopAnyPermission } from '@/lib/api-auth'
import { StaffManagement } from '@/components/shop/staff-management'
import { getShopStaffRoster } from '@/lib/server/shop-staff-projection'
import { getShopStaffRoles } from '@/lib/server/shop-staff-roles'

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
  if (!guarded.ok || !guarded.shopId || !guarded.principal) notFound()

  const [initialStaff, initialRoles] = await Promise.all([
    getShopStaffRoster(guarded.shopId, guarded.principal),
    getShopStaffRoles(guarded.shopId, guarded.principal),
  ])
  return <StaffManagement initialStaff={initialStaff} initialRoles={initialRoles} />
}
