import { redirect } from 'next/navigation'
import { requireApiSession } from '@/lib/api-auth'
import { getShopNasiyalarList } from '@/lib/server/shop-lists'
import NasiyalarClient from './nasiyalar-client'

export default async function NasiyalarPage() {
  const guarded = await requireApiSession()
  if (!guarded.ok || !guarded.shopId) redirect('/shop/login')

  const nasiyalar = await getShopNasiyalarList(guarded.shopId)

  return <NasiyalarClient initialNasiyalar={nasiyalar} />
}
