import { redirect } from 'next/navigation'
import { requireApiSession } from '@/lib/api-auth'

/**
 * The shop root is role-aware on the server so a worker never briefly loads
 * an owner dashboard during login or direct navigation.
 */
export default async function ShopLandingPage() {
  const guarded = await requireApiSession()
  if (!guarded.ok || !guarded.principal) redirect('/shop/login')

  redirect(guarded.principal.memberKind === 'SHOP_STAFF'
    ? '/shop/yangi-operatsiya'
    : '/shop/dashboard')
}
