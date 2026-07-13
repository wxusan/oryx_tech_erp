import type { Session } from 'next-auth'
import { cache } from 'react'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { badRequest, forbidden, unauthorized } from '@/lib/api-helpers'
import { initializeRequestAuditContext } from '@/lib/server/request-context'

type GuardResult =
  | { ok: true; session: Session; shopId?: string }
  | { ok: false; response: ReturnType<typeof unauthorized> }

const SUBSCRIPTION_GRACE_MS = 3 * 24 * 60 * 60 * 1000
const ADMIN_IDLE_TIMEOUT_MS = 10 * 60 * 1000
const ADMIN_ACTIVITY_WRITE_INTERVAL_MS = 60 * 1000
const SHOP_ACTIVITY_WRITE_INTERVAL_MS = 15 * 60 * 1000
const SESSION_ROLLING_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000

function subscriptionCutoff() {
  return new Date(Date.now() - SUBSCRIPTION_GRACE_MS)
}

async function requireApiSessionUncached(): Promise<GuardResult> {
  await initializeRequestAuditContext()
  const session = await auth()
  if (!session?.user) return { ok: false, response: unauthorized() }
  if (!session.user.sessionId) {
    return { ok: false, response: unauthorized('Sessiya yangilanishi kerak. Qayta kiring.') }
  }

  const now = new Date()
  const liveSession = await prisma.authSession.findUnique({
    where: { id: session.user.sessionId },
    select: {
      actorId: true,
      actorType: true,
      shopId: true,
      sessionVersion: true,
      lastSeenAt: true,
      expiresAt: true,
      revokedAt: true,
    },
  })
  const idleExpired = session.user.role === 'SUPER_ADMIN' &&
    Boolean(liveSession && liveSession.lastSeenAt.getTime() <= now.getTime() - ADMIN_IDLE_TIMEOUT_MS)
  const invalidSession = !liveSession || liveSession.revokedAt !== null || liveSession.expiresAt <= now || idleExpired ||
    liveSession.actorId !== session.user.id || liveSession.actorType !== session.user.role ||
    liveSession.shopId !== session.user.shopId || liveSession.sessionVersion !== session.user.sessionVersion

  if (invalidSession) {
    if (liveSession && liveSession.revokedAt === null) {
      await prisma.authSession.updateMany({
        where: { id: session.user.sessionId, revokedAt: null },
        data: { revokedAt: now },
      })
    }
    return {
      ok: false,
      response: unauthorized(idleExpired ? "Bosh admin sessiyasi 10 daqiqa harakatsizlikdan so'ng yakunlandi" : 'Sessiya bekor qilingan'),
    }
  }

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

  const writeInterval = session.user.role === 'SUPER_ADMIN'
    ? ADMIN_ACTIVITY_WRITE_INTERVAL_MS
    : SHOP_ACTIVITY_WRITE_INTERVAL_MS
  if (liveSession.lastSeenAt.getTime() <= now.getTime() - writeInterval) {
    await prisma.authSession.updateMany({
      where: {
        id: session.user.sessionId,
        revokedAt: null,
        lastSeenAt: liveSession.lastSeenAt,
      },
      data: {
        lastSeenAt: now,
        expiresAt: new Date(now.getTime() + SESSION_ROLLING_LIFETIME_MS),
      },
    })
  }

  return { ok: true, session, shopId: session.user.shopId ?? undefined }
}

/** React memoization prevents a layout and its page from repeating auth DB checks in one render. */
export const requireApiSession = cache(requireApiSessionUncached)

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

  // For a shop admin, requireApiSession() has ALREADY validated this exact shop
  // (ACTIVE, not deleted, subscription in grace) via the shopAdmin.findFirst join
  // in the same request. Re-querying it here is a redundant round-trip, so we
  // trust the session-derived shopId. Super admins pass an arbitrary shopId that
  // was NOT pre-validated, so they still need the DB check below.
  if (session.user.role === 'SHOP_ADMIN') {
    return { ok: true, shopId }
  }

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
  const authorization = request.headers.get('authorization')
  if (!authorization) return false

  // INTERNAL_API_SECRET is the preferred credential for application-owned
  // calls, while Vercel Cron always sends CRON_SECRET. When both are set they
  // are two independent valid credentials, not an override chain.
  const configuredSecrets = [process.env.INTERNAL_API_SECRET, process.env.CRON_SECRET]
    .filter((secret): secret is string => Boolean(secret))
  return configuredSecrets.some((secret) => authorization === `Bearer ${secret}`)
}

export function internalFetchHeaders(): HeadersInit {
  const secret = internalSecret()
  return secret ? { authorization: `Bearer ${secret}` } : {}
}
