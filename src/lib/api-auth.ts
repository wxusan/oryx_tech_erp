import type { Session } from 'next-auth'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { badRequest, forbidden, unauthorized } from '@/lib/api-helpers'

type GuardResult =
  | { ok: true; session: Session; shopId?: string }
  | { ok: false; response: ReturnType<typeof unauthorized> }

const SUBSCRIPTION_GRACE_MS = 3 * 24 * 60 * 60 * 1000

function subscriptionCutoff() {
  return new Date(Date.now() - SUBSCRIPTION_GRACE_MS)
}

export async function requireApiSession(): Promise<GuardResult> {
  const session = await auth()
  if (!session?.user) return { ok: false, response: unauthorized() }

  if (session.user.role === 'SHOP_ADMIN') {
    if (!session.user.shopId) {
      return { ok: false, response: forbidden("Do'kon ma'lumotlari topilmadi") }
    }

    const activeAdmin = await prisma.shopAdmin.findFirst({
      where: {
        id: session.user.id,
        shopId: session.user.shopId,
        isActive: true,
        deletedAt: null,
        shop: {
          status: 'ACTIVE',
          deletedAt: null,
          subscriptionDue: { gte: subscriptionCutoff() },
        },
      },
      select: { shopId: true, sessionVersion: true },
    })

    if (!activeAdmin || activeAdmin.sessionVersion !== session.user.sessionVersion) {
      return { ok: false, response: forbidden("Do'kon faol emas yoki ruxsat bekor qilingan") }
    }
  }

  if (session.user.role === 'SUPER_ADMIN') {
    const activeSuperAdmin = await prisma.superAdmin.findFirst({
      where: { id: session.user.id, deletedAt: null },
      select: { id: true, sessionVersion: true },
    })

    if (!activeSuperAdmin || activeSuperAdmin.sessionVersion !== session.user.sessionVersion) {
      return { ok: false, response: forbidden("Bosh admin ruxsati bekor qilingan") }
    }
  }

  return { ok: true, session, shopId: session.user.shopId ?? undefined }
}

export async function requireSuperAdmin(): Promise<GuardResult> {
  const guarded = await requireApiSession()
  if (!guarded.ok) return guarded
  if (guarded.session.user.role !== 'SUPER_ADMIN') return { ok: false, response: forbidden() }
  return guarded
}

export async function resolveActiveShopId(
  session: Session,
  requestedShopId?: string | null,
): Promise<
  | { ok: true; shopId: string }
  | { ok: false; response: ReturnType<typeof forbidden> | ReturnType<typeof badRequest> }
> {
  const shopId = session.user.role === 'SHOP_ADMIN' ? session.user.shopId : requestedShopId
  if (!shopId) return { ok: false, response: badRequest('shopId talab qilinadi') }

  const shop = await prisma.shop.findFirst({
    where: {
      id: shopId,
      status: 'ACTIVE',
      deletedAt: null,
      subscriptionDue: { gte: subscriptionCutoff() },
    },
    select: { id: true },
  })
  if (!shop) return { ok: false, response: forbidden("Do'kon faol emas, muddati tugagan yoki topilmadi") }

  return { ok: true, shopId }
}

export function internalSecret(): string | undefined {
  return process.env.INTERNAL_API_SECRET || process.env.CRON_SECRET
}

export function hasValidInternalSecret(request: Request): boolean {
  const secret = internalSecret()
  if (!secret) return false
  return request.headers.get('authorization') === `Bearer ${secret}`
}

export function internalFetchHeaders(): HeadersInit {
  const secret = internalSecret()
  return secret ? { authorization: `Bearer ${secret}` } : {}
}
