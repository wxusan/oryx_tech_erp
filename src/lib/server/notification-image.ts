import 'server-only'

import { prisma } from '@/lib/prisma'
import { getSupabaseAdminClient, PRIVATE_STORAGE_BUCKET } from '@/lib/supabase-admin'

/**
 * Resolve a SAFE, Telegram-fetchable image for a notification at SEND time.
 *
 * Returns a short-lived signed URL for the related device's first photo, or null
 * when there is no device image (→ the notification falls back to a text
 * message). Signed at send time so the URL is always fresh for Telegram to fetch,
 * and never persisted anywhere.
 *
 * Privacy: only DEVICE photos are ever attached. Customer-document images (ID
 * scans, etc.) live under a different key path and are never referenced here; a
 * regex guard additionally rejects any key outside `/devices/`. The permanent
 * private URL is never exposed — only a short-TTL signed URL.
 */

// Long enough for Telegram's servers to fetch the photo, short enough to stay
// safe. Telegram fetches immediately on send, so 10 minutes is generous.
const SIGNED_URL_TTL_SECONDS = 10 * 60

// Device image keys look like `shops/<shopId>/devices/<uuid>`. Other private
// uploads use a different segment, so this pattern only ever matches a device
// image.
const DEVICE_KEY_PATTERN = /^shops\/[^/]+\/devices\/[^/]+$/

interface NotificationRef {
  relatedType: string | null
  relatedId: string | null
}

async function deviceImageKeyFor(ref: NotificationRef): Promise<string | null> {
  const { relatedType, relatedId } = ref
  if (!relatedType || !relatedId) return null

  switch (relatedType) {
    case 'Device': {
      const device = await prisma.device.findUnique({
        where: { id: relatedId },
        select: { imageUrls: true },
      })
      return device?.imageUrls?.[0] ?? null
    }
    case 'Sale': {
      const sale = await prisma.sale.findUnique({
        where: { id: relatedId },
        select: { device: { select: { imageUrls: true } } },
      })
      return sale?.device?.imageUrls?.[0] ?? null
    }
    case 'DeviceReturn': {
      const ret = await prisma.deviceReturn.findUnique({
        where: { id: relatedId },
        select: { device: { select: { imageUrls: true } } },
      })
      return ret?.device?.imageUrls?.[0] ?? null
    }
    case 'Nasiya': {
      const nasiya = await prisma.nasiya.findUnique({
        where: { id: relatedId },
        select: { device: { select: { imageUrls: true } } },
      })
      return nasiya?.device?.imageUrls?.[0] ?? null
    }
    case 'NasiyaSchedule': {
      const schedule = await prisma.nasiyaSchedule.findUnique({
        where: { id: relatedId },
        select: { nasiya: { select: { device: { select: { imageUrls: true } } } } },
      })
      return schedule?.nasiya?.device?.imageUrls?.[0] ?? null
    }
    case 'SupplierPayable': {
      const payable = await prisma.supplierPayable.findUnique({
        where: { id: relatedId },
        select: { device: { select: { imageUrls: true } } },
      })
      return payable?.device?.imageUrls?.[0] ?? null
    }
    default:
      return null
  }
}

export async function resolveNotificationImageUrl(ref: NotificationRef): Promise<string | null> {
  try {
    const key = await deviceImageKeyFor(ref)
    if (!key || !DEVICE_KEY_PATTERN.test(key)) return null

    const supabase = getSupabaseAdminClient()
    const { data, error } = await supabase.storage
      .from(PRIVATE_STORAGE_BUCKET)
      .createSignedUrl(key, SIGNED_URL_TTL_SECONDS)

    if (error || !data?.signedUrl) return null
    return data.signedUrl
  } catch {
    // Missing Supabase config, deleted object, network error, etc. — never let
    // image resolution break delivery; fall back to a text message.
    return null
  }
}
