import { NextRequest } from 'next/server'
import bcrypt from 'bcrypt'
import { Prisma } from '@/generated/prisma/client'
import { requireCurrentShopAnyPermission, requireCurrentShopPermission } from '@/lib/api-auth'
import { badRequest, conflict, created, forbidden, ok, payloadTooLarge, serverError } from '@/lib/api-helpers'
import {
  SHOP_PERMISSION_CATALOG,
  permissionRequiredFeatures,
  type ShopPermissionCode,
} from '@/lib/access-control'
import { prisma } from '@/lib/prisma'
import {
  getLiveShopPrincipalForMutation,
  principalHasPermission,
} from '@/lib/server/shop-access'
import {
  createShopStaffSchema,
  withStaffLogsPermission,
} from '@/lib/shop-staff-contract'
import {
  principalNeedsStaffTargets,
  projectShopStaff,
  shopStaffProjectionSelect,
} from '@/lib/server/shop-staff-projection'
import { isTelegramIdTaken, normalizeTelegramId } from '@/lib/telegram-id'
import {
  isInvalidRequestBody,
  isRequestBodyTooLarge,
  readLimitedJsonBody,
} from '@/lib/server/request-limits'
import { isRetryableTransactionError } from '@/lib/server/transaction-retry'
import { logger } from '@/lib/logger'

const STAFF_ADMIN_PERMISSIONS = [
  'STAFF_VIEW',
  'STAFF_CREATE',
  'STAFF_EDIT_PROFILE',
  'STAFF_RESET_PASSWORD',
  'STAFF_STATUS_MANAGE',
  'STAFF_DELETE',
  'STAFF_PERMISSION_MANAGE',
  'STAFF_NOTIFICATION_MANAGE',
] as const satisfies readonly ShopPermissionCode[]

function permissionError(
  permissionCodes: readonly ShopPermissionCode[],
  enabledFeatures: ReadonlySet<string>,
) {
  for (const code of permissionCodes) {
    const definition = SHOP_PERMISSION_CATALOG.find((item) => item.code === code)
    if (!definition || definition.retired || definition.ownerOnly) return "Xodimga bu ruxsatni berib bo'lmaydi"
    if (permissionRequiredFeatures(code).some((feature) => !enabledFeatures.has(feature))) {
      return `${definition.label} uchun kerakli modul do'kon paketida yoqilmagan`
    }
  }
  return null
}

async function runSerializable<T>(operation: () => Promise<T>) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      if (!isRetryableTransactionError(error) || attempt === 2) throw error
    }
  }
  throw new Error('SERIALIZABLE_TRANSACTION_FAILED')
}

export async function GET() {
  try {
    const guarded = await requireCurrentShopAnyPermission(STAFF_ADMIN_PERMISSIONS)
    if (!guarded.ok) return guarded.response
    const { shopId, principal } = guarded
    if (!shopId || !principal) return serverError()
    if (!principalNeedsStaffTargets(principal)) return ok([])

    const shop = await prisma.shop.findUnique({ where: { id: shopId }, select: { ownerAdminId: true } })
    const staff = await prisma.shopAdmin.findMany({
      where: {
        shopId,
        id: { notIn: [principal.actorId, shop?.ownerAdminId].filter((id): id is string => Boolean(id)) },
        deletedAt: null,
      },
      orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }],
      select: shopStaffProjectionSelect,
    })
    return ok(staff.map((row) => projectShopStaff(row, principal)))
  } catch (error) {
    logger.error('[GET /api/shop/staff]', { event: 'api.route_error', error })
    return serverError()
  }
}

export async function POST(request: NextRequest) {
  try {
    const guarded = await requireCurrentShopPermission('STAFF_CREATE')
    if (!guarded.ok) return guarded.response
    const { shopId, principal, session } = guarded
    if (!shopId || !principal) return serverError()

    const parsed = createShopStaffSchema.safeParse(await readLimitedJsonBody(request))
    if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? "Xodim ma'lumoti noto'g'ri")

    const permissionCodes = withStaffLogsPermission(
      parsed.data.permissionCodes,
      parsed.data.logsViewEnabled,
    )
    if (
      principal.memberKind === 'SHOP_STAFF' &&
      (permissionCodes.length > 0 || parsed.data.telegramNotificationsEnabled)
    ) {
      return forbidden("Xodim yangi profilni ruxsatsiz va Telegram xabarlari o'chirilgan holatda yaratishi mumkin")
    }
    const permissionMessage = permissionError(permissionCodes, principal.enabledFeatures)
    if (permissionMessage) return badRequest(permissionMessage)
    if (parsed.data.telegramNotificationsEnabled && !principal.enabledFeatures.has('TELEGRAM')) {
      return badRequest("Telegram moduli yoqilmagani uchun xodim bildirishnomalarini yoqib bo'lmaydi")
    }

    const telegramId = normalizeTelegramId(parsed.data.telegramId)
    if (telegramId && await isTelegramIdTaken(telegramId)) {
      return conflict(`Bu Telegram ID allaqachon tizimda bor: ${telegramId}`)
    }
    const passwordHash = await bcrypt.hash(parsed.data.password, 12)

    const row = await runSerializable(() => prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Shop" WHERE "id" = ${shopId} FOR UPDATE`)
      const livePrincipal = await getLiveShopPrincipalForMutation(tx, {
        shopId,
        actorId: session.user.id,
      })
      if (!livePrincipal || !principalHasPermission(livePrincipal, 'STAFF_CREATE')) {
        throw Object.assign(new Error('AUTHORIZATION_CHANGED'), { code: 'AUTHORIZATION_CHANGED' })
      }
      if (
        livePrincipal.memberKind === 'SHOP_STAFF' &&
        (permissionCodes.length > 0 || parsed.data.telegramNotificationsEnabled)
      ) {
        throw Object.assign(new Error('DELEGATED_CREATE_SCOPE'), { code: 'DELEGATED_CREATE_SCOPE' })
      }
      const livePermissionMessage = permissionError(permissionCodes, livePrincipal.enabledFeatures)
      if (livePermissionMessage) {
        throw Object.assign(new Error(livePermissionMessage), { code: 'PERMISSION_INVALID' })
      }
      if (parsed.data.telegramNotificationsEnabled && !livePrincipal.enabledFeatures.has('TELEGRAM')) {
        throw Object.assign(new Error('TELEGRAM_DISABLED'), { code: 'TELEGRAM_DISABLED' })
      }
      if (telegramId) {
        await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`telegram:${telegramId}`}))`)
        const [superAdminOwner, shopAdminOwner] = await Promise.all([
          tx.superAdmin.findFirst({ where: { telegramId, deletedAt: null }, select: { id: true } }),
          tx.shopAdmin.findFirst({ where: { telegramId, deletedAt: null }, select: { id: true } }),
        ])
        if (superAdminOwner || shopAdminOwner) {
          throw Object.assign(new Error('TELEGRAM_TAKEN'), { code: 'TELEGRAM_TAKEN' })
        }
      }
      const createdStaff = await tx.shopAdmin.create({
        data: {
          shopId,
          name: parsed.data.name,
          phone: parsed.data.phone,
          login: parsed.data.login,
          telegramId,
          telegramVerifiedAt: null,
          telegramNotificationsEnabled: parsed.data.telegramNotificationsEnabled,
          isActive: parsed.data.isActive,
          passwordHash,
          legacyFullAccess: false,
        },
        select: { id: true },
      })
      if (permissionCodes.length) {
        await tx.shopMemberPermission.createMany({
          data: permissionCodes.map((permissionCode) => ({
            shopId,
            shopAdminId: createdStaff.id,
            permissionCode,
            grantedById: session.user.id,
          })),
        })
      }

      await tx.shop.update({ where: { id: shopId }, data: { authorizationVersion: { increment: 1 } } })
      await tx.log.create({
        data: {
          shopId,
          actorId: session.user.id,
          actorType: 'SHOP_ADMIN',
          action: 'STAFF_CREATE',
          targetType: 'ShopAdmin',
          targetId: createdStaff.id,
          newValue: {
            name: parsed.data.name,
            login: parsed.data.login,
            isActive: parsed.data.isActive,
            permissionCodes,
            logsViewEnabled: parsed.data.logsViewEnabled,
            telegramNotificationsEnabled: parsed.data.telegramNotificationsEnabled,
          },
        },
      })
      return tx.shopAdmin.findUniqueOrThrow({ where: { id: createdStaff.id }, select: shopStaffProjectionSelect })
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }))

    return created(projectShopStaff(row, principal), "Xodim profili qo'shildi")
  } catch (error) {
    if (isRequestBodyTooLarge(error)) return payloadTooLarge()
    if (isInvalidRequestBody(error)) return badRequest("So'rov ma'lumoti noto'g'ri")
    if (error && typeof error === 'object' && 'code' in error) {
      if (error.code === 'STAFF_ACCESS_DISABLED') return conflict("Xodimlar profili o'chirilgan")
      if (error.code === 'AUTHORIZATION_CHANGED') return forbidden("Ruxsat o'zgargan. Sahifani yangilang")
      if (error.code === 'DELEGATED_CREATE_SCOPE') return forbidden("Xodim yangi profilga ruxsat yoki Telegram bera olmaydi")
      if (error.code === 'PERMISSION_INVALID') return badRequest(error instanceof Error ? error.message : "Ruxsat noto'g'ri")
      if (error.code === 'TELEGRAM_DISABLED') return badRequest("Telegram moduli yoqilmagan")
      if (error.code === 'TELEGRAM_TAKEN') return conflict('Bu Telegram ID allaqachon mavjud')
      if (error.code === 'P2002') return conflict('Login yoki Telegram ID allaqachon mavjud')
    }
    logger.error('[POST /api/shop/staff]', { event: 'api.route_error', error })
    return serverError()
  }
}
