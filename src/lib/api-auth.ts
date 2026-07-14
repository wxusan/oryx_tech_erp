import type { Session } from 'next-auth'
import { cache } from 'react'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { badRequest, forbidden, unauthorized } from '@/lib/api-helpers'
import { initializeRequestAuditContext } from '@/lib/server/request-context'
import {
  buildShopPrincipal,
  getActiveShopPackage,
  principalHasFeature,
  principalHasPermission,
  type ShopPrincipal,
} from '@/lib/server/shop-access'
import type { ShopFeatureCode, ShopPermissionCode } from '@/lib/access-control'

type GuardResult =
  | { ok: true; session: Session; shopId?: string; principal?: ShopPrincipal }
  | { ok: false; response: ReturnType<typeof unauthorized> }

const SUBSCRIPTION_GRACE_MS = 3 * 24 * 60 * 60 * 1000
const ADMIN_IDLE_TIMEOUT_MS = 10 * 60 * 1000

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
      packageVersionId: true,
      sessionVersion: true,
      policy: true,
      lastSeenAt: true,
      lastUserActivityAt: true,
      expiresAt: true,
      revokedAt: true,
    },
  })
  const idleExpired = liveSession?.policy === 'IDLE_10_MINUTES' &&
    liveSession.lastUserActivityAt.getTime() <= now.getTime() - ADMIN_IDLE_TIMEOUT_MS
  const invalidSession = !liveSession || liveSession.revokedAt !== null || liveSession.expiresAt <= now || idleExpired ||
    liveSession.actorId !== session.user.id || liveSession.actorType !== session.user.role ||
    liveSession.shopId !== session.user.shopId || liveSession.sessionVersion !== session.user.sessionVersion ||
    liveSession.policy !== session.user.sessionPolicy || liveSession.packageVersionId !== session.user.packageVersionId

  if (invalidSession) {
    if (liveSession && liveSession.revokedAt === null) {
      await prisma.authSession.updateMany({
        where: { id: session.user.sessionId, revokedAt: null },
        data: { revokedAt: now },
      })
    }
    return {
      ok: false,
      response: unauthorized(idleExpired ? "Sessiya 10 daqiqa harakatsizlikdan so'ng yakunlandi" : 'Sessiya bekor qilingan'),
    }
  }

  let shopPrincipal: ShopPrincipal | undefined

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
      select: {
        shopId: true,
        sessionVersion: true,
        permissionVersion: true,
        legacyFullAccess: true,
        permissions: { select: { permissionCode: true } },
        shop: { select: { ownerAdminId: true, authorizationVersion: true } },
      },
    })

    if (!activeAdmin || activeAdmin.sessionVersion !== session.user.sessionVersion) {
      return { ok: false, response: forbidden("Do'kon faol emas yoki ruxsat bekor qilingan") }
    }

    const activePackage = await getActiveShopPackage(session.user.shopId, now)
    if (!activePackage) {
      return { ok: false, response: forbidden("Do'kon paketi sozlanmagan") }
    }
    if (liveSession.packageVersionId !== activePackage.id) {
      await prisma.authSession.updateMany({
        where: { id: session.user.sessionId, revokedAt: null },
        data: { revokedAt: now },
      })
      return { ok: false, response: forbidden("Do'kon paketi o'zgargan. Qayta kiring") }
    }

    shopPrincipal = buildShopPrincipal({
      actorId: session.user.id,
      shopId: activeAdmin.shopId,
      ownerAdminId: activeAdmin.shop.ownerAdminId,
      legacyFullAccess: activeAdmin.legacyFullAccess,
      authorizationVersion: activeAdmin.shop.authorizationVersion,
      permissionVersion: activeAdmin.permissionVersion,
      permissionCodes: activeAdmin.permissions.map((item) => item.permissionCode),
      packageVersion: activePackage,
    })

    if (shopPrincipal.memberKind === 'SHOP_STAFF' && !principalHasFeature(shopPrincipal, 'STAFF_ACCESS')) {
      await prisma.authSession.updateMany({
        where: { id: session.user.sessionId, revokedAt: null },
        data: { revokedAt: now },
      })
      return { ok: false, response: forbidden("Bu do'konda xodim profillari o'chirilgan") }
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

  return { ok: true, session, shopId: session.user.shopId ?? undefined, principal: shopPrincipal }
}

/** React memoization prevents a layout and its page from repeating auth DB checks in one render. */
export const requireApiSession = cache(requireApiSessionUncached)

export async function requireSuperAdmin(): Promise<GuardResult> {
  const guarded = await requireApiSession()
  if (!guarded.ok) return guarded
  if (guarded.session.user.role !== 'SUPER_ADMIN') return { ok: false, response: forbidden() }
  return guarded
}

export async function requireCurrentShopPermission(permission: ShopPermissionCode): Promise<GuardResult> {
  const guarded = await requireApiSession()
  if (!guarded.ok) return guarded
  if (guarded.session.user.role !== 'SHOP_ADMIN' || !guarded.principal) {
    return { ok: false, response: forbidden("Do'kon foydalanuvchisi ruxsati talab qilinadi") }
  }
  if (!principalHasPermission(guarded.principal, permission)) {
    return { ok: false, response: forbidden("Bu amal uchun ruxsat berilmagan") }
  }
  return guarded
}

export async function requireCurrentShopAnyPermission(
  permissions: readonly ShopPermissionCode[],
): Promise<GuardResult> {
  const guarded = await requireApiSession()
  if (!guarded.ok) return guarded
  if (guarded.session.user.role !== 'SHOP_ADMIN' || !guarded.principal) {
    return { ok: false, response: forbidden("Do'kon foydalanuvchisi ruxsati talab qilinadi") }
  }
  if (!permissions.some((permission) => principalHasPermission(guarded.principal!, permission))) {
    return { ok: false, response: forbidden("Bu amal uchun ruxsat berilmagan") }
  }
  return guarded
}

/**
 * Guard shared operational routes. Super admins retain their existing audited
 * cross-shop access; shop members are checked against the live package and
 * live member permissions on every request.
 */
export async function requireShopPermission(permission: ShopPermissionCode): Promise<GuardResult> {
  const guarded = await requireApiSession()
  if (!guarded.ok) return guarded
  if (guarded.session.user.role === 'SUPER_ADMIN') return guarded
  if (!guarded.principal || !principalHasPermission(guarded.principal, permission)) {
    return { ok: false, response: forbidden("Bu amal uchun ruxsat berilmagan") }
  }
  return guarded
}

/**
 * Authorize a narrow shared foundation used by more than one operational
 * module (for example the limited customer picker). The caller still owns the
 * exact tenant-scoped DTO and must not return broader module data.
 */
export async function requireShopAnyPermission(permissions: readonly ShopPermissionCode[]): Promise<GuardResult> {
  const guarded = await requireApiSession()
  if (!guarded.ok) return guarded
  if (guarded.session.user.role === 'SUPER_ADMIN') return guarded
  if (!guarded.principal || !permissions.some((permission) => principalHasPermission(guarded.principal!, permission))) {
    return { ok: false, response: forbidden("Bu amal uchun ruxsat berilmagan") }
  }
  return guarded
}

export async function requireShopPermissionAndFeature(
  permission: ShopPermissionCode,
  feature: ShopFeatureCode,
): Promise<GuardResult> {
  const guarded = await requireShopPermission(permission)
  if (!guarded.ok || guarded.session.user.role === 'SUPER_ADMIN') return guarded
  if (!guarded.principal || !principalHasFeature(guarded.principal, feature)) {
    return { ok: false, response: forbidden("Bu modul do'kon paketida yoqilmagan") }
  }
  return guarded
}

export async function requireShopPermissionAndAnyFeature(
  permission: ShopPermissionCode,
  features: readonly ShopFeatureCode[],
): Promise<GuardResult> {
  const guarded = await requireShopPermission(permission)
  if (!guarded.ok || guarded.session.user.role === 'SUPER_ADMIN') return guarded
  if (!guarded.principal || !features.some((feature) => principalHasFeature(guarded.principal!, feature))) {
    return { ok: false, response: forbidden("Kerakli modul do'kon paketida yoqilmagan") }
  }
  return guarded
}

/** A scoped work queue: each cohort is included only when the member can view
 * receivables or perform an operation on that exact contract family. */
export async function requireReceivableView(): Promise<
  | (Extract<GuardResult, { ok: true }> & { includeCashSales: boolean; includeNasiya: boolean })
  | Extract<GuardResult, { ok: false }>
> {
  const guarded = await requireApiSession()
  if (!guarded.ok) return guarded
  const includeCashSales = guarded.session.user.role === 'SUPER_ADMIN' || Boolean(
    guarded.principal &&
    principalHasFeature(guarded.principal, 'CASH_SALES') &&
    ['RECEIVABLES_VIEW', 'SALE_VIEW', 'SALE_PAYMENT_RECEIVE'].some((permission) => (
      principalHasPermission(guarded.principal!, permission as ShopPermissionCode)
    )),
  )
  const includeNasiya = guarded.session.user.role === 'SUPER_ADMIN' || Boolean(
    guarded.principal &&
    principalHasFeature(guarded.principal, 'NASIYA') &&
    ['RECEIVABLES_VIEW', 'NASIYA_VIEW', 'NASIYA_PAYMENT_RECEIVE', 'NASIYA_DEFER'].some((permission) => (
      principalHasPermission(guarded.principal!, permission as ShopPermissionCode)
    )),
  )
  if (!includeCashSales && !includeNasiya) {
    return { ok: false, response: forbidden("Qarzdorlikni ko'rish uchun ruxsat berilmagan") }
  }
  return { ...guarded, includeCashSales, includeNasiya }
}

export async function requireCurrentShopFeature(feature: ShopFeatureCode): Promise<GuardResult> {
  const guarded = await requireApiSession()
  if (!guarded.ok) return guarded
  if (guarded.session.user.role !== 'SHOP_ADMIN' || !guarded.principal) {
    return { ok: false, response: forbidden("Do'kon foydalanuvchisi ruxsati talab qilinadi") }
  }
  if (!principalHasFeature(guarded.principal, feature)) {
    return { ok: false, response: forbidden("Bu modul do'kon paketida yoqilmagan") }
  }
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
