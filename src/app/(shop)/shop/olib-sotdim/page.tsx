import { redirect } from 'next/navigation'
import { requireCurrentShopAnyPermission } from '@/lib/api-auth'
import { positivePage, scalarParam } from '@/lib/list-url-state'
import OlibSotdimClient from './olib-sotdim-client'

export default async function OlibSotdimPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string | string[]; page?: string | string[] }>
}) {
  const guarded = await requireCurrentShopAnyPermission(['OLIB_VIEW', 'SUPPLIER_PAYABLE_VIEW', 'SUPPLIER_PAYMENT_RECORD', 'SUPPLIER_PAYMENT_MARK_PAID'])
  if (!guarded.ok || !guarded.shopId) redirect('/shop/dashboard')
  const params = await searchParams
  return (
    <OlibSotdimClient
      initialSearch={scalarParam(params?.q).slice(0, 100)}
      initialPage={positivePage(params?.page) - 1}
    />
  )
}
