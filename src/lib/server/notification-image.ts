import 'server-only'

import { prisma } from '@/lib/prisma'
import { getSupabaseAdminClient, PRIVATE_STORAGE_BUCKET } from '@/lib/supabase-admin'

const SIGNED_URL_TTL_SECONDS = 10 * 60

export interface NotificationRef {
  shopId: string
  relatedType: string | null
  relatedId: string | null
}

function validDeviceKey(shopId: string, key: string): boolean {
  const prefix = `shops/${shopId}/devices/`
  const objectName = key.startsWith(prefix) ? key.slice(prefix.length) : ''
  return objectName.length > 0 && !objectName.includes('/')
}

function orderedUnique(keys: string[]): string[] {
  return [...new Set(keys)]
}

/** Resolve every related device key and enforce tenant ownership. */
export async function resolveNotificationImageKeys(ref: NotificationRef): Promise<string[]> {
  const { relatedType, relatedId, shopId } = ref
  if (!relatedType || !relatedId) return []

  let row: { imageUrls: string[] } | null = null
  switch (relatedType) {
    case 'Device':
      row = await prisma.device.findFirst({ where: { id: relatedId, shopId }, select: { imageUrls: true } })
      break
    case 'Sale': {
      const value = await prisma.sale.findFirst({ where: { id: relatedId, shopId }, select: { device: { select: { imageUrls: true } } } })
      row = value?.device ?? null
      break
    }
    case 'DeviceReturn': {
      const value = await prisma.deviceReturn.findFirst({ where: { id: relatedId, shopId }, select: { device: { select: { imageUrls: true } } } })
      row = value?.device ?? null
      break
    }
    case 'Nasiya': {
      const value = await prisma.nasiya.findFirst({ where: { id: relatedId, shopId }, select: { device: { select: { imageUrls: true } } } })
      row = value?.device ?? null
      break
    }
    case 'NasiyaSchedule': {
      const value = await prisma.nasiyaSchedule.findFirst({ where: { id: relatedId, shopId }, select: { nasiya: { select: { device: { select: { imageUrls: true } } } } } })
      row = value?.nasiya.device ?? null
      break
    }
    case 'SupplierPayable': {
      const value = await prisma.supplierPayable.findFirst({ where: { id: relatedId, shopId }, select: { device: { select: { imageUrls: true } } } })
      row = value?.device ?? null
      break
    }
  }

  return orderedUnique(row?.imageUrls ?? []).filter((key) => validDeviceKey(shopId, key))
}

export interface ResolvedNotificationImage {
  position: number
  key: string
  imageUrl: string | null
}

/** Sign every pending key independently; one missing object never drops peers. */
export async function resolveNotificationImageUrls(
  shopId: string,
  mediaKeys: string[],
  positions: number[],
): Promise<ResolvedNotificationImage[]> {
  const supabase = getSupabaseAdminClient()
  return Promise.all(positions.map(async (position) => {
    const key = mediaKeys[position]
    if (!key || !validDeviceKey(shopId, key)) return { position, key: key ?? '', imageUrl: null }
    try {
      const { data, error } = await supabase.storage.from(PRIVATE_STORAGE_BUCKET).createSignedUrl(key, SIGNED_URL_TTL_SECONDS)
      return { position, key, imageUrl: error ? null : data?.signedUrl ?? null }
    } catch {
      return { position, key, imageUrl: null }
    }
  }))
}

/** Back-compatible helper. */
export async function resolveNotificationImageUrl(ref: NotificationRef): Promise<string | null> {
  const keys = await resolveNotificationImageKeys(ref)
  if (!keys.length) return null
  return (await resolveNotificationImageUrls(ref.shopId, keys, [0]))[0]?.imageUrl ?? null
}
