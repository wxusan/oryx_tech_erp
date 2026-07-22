import { NextRequest } from 'next/server'
import { Prisma } from '@/generated/prisma/client'
import { requireCurrentShopAnyPermission, requireCurrentShopPermission } from '@/lib/api-auth'
import { badRequest, conflict, created, forbidden, ok, payloadTooLarge, serverError } from '@/lib/api-helpers'
import {
  SHOP_PERMISSION_CATALOG,
  type ShopPermissionCode,
} from '@/lib/access-control'
import { prisma } from '@/lib/prisma'
import {
  createShopStaffRoleSchema,
  MAX_CUSTOM_STAFF_ROLES,
  normalizedRoleName,
  rolePermissionCodesWithLogs,
} from '@/lib/shop-staff-role-contract'
import {
  getShopStaffRoles,
  projectShopStaffRole,
  shopStaffRoleSelect,
} from '@/lib/server/shop-staff-roles'
import { getLiveShopPrincipalForMutation, principalHasPermission } from '@/lib/server/shop-access'
import {
  isInvalidRequestBody,
  isRequestBodyTooLarge,
  readLimitedJsonBody,
} from '@/lib/server/request-limits'
import { isRetryableTransactionError } from '@/lib/server/transaction-retry'
import { logger } from '@/lib/logger'
import { SHOP_STAFF_ROLE_KIND } from '@/lib/staff-role-presets'

const STAFF_ROLE_READ_PERMISSIONS = [
  'STAFF_VIEW',
  'STAFF_CREATE',
  'STAFF_EDIT_PROFILE',
  'STAFF_PERMISSION_MANAGE',
] as const satisfies readonly ShopPermissionCode[]

function validateRolePermissions(
  permissionCodes: readonly ShopPermissionCode[],
) {
  for (const code of permissionCodes) {
    const permission = SHOP_PERMISSION_CATALOG.find((item) => item.code === code)
    if (!permission || permission.ownerOnly || permission.retired) return "Lavozimga bu ruxsatni berib bo'lmaydi"
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
    const guarded = await requireCurrentShopAnyPermission(STAFF_ROLE_READ_PERMISSIONS)
    if (!guarded.ok) return guarded.response
    const { shopId, principal } = guarded
    if (!shopId || !principal) return serverError()
    return ok(await getShopStaffRoles(shopId, principal))
  } catch (error) {
    logger.error('[GET /api/shop/staff/roles]', { event: 'api.route_error', error })
    return serverError()
  }
}

export async function POST(request: NextRequest) {
  try {
    const guarded = await requireCurrentShopPermission('STAFF_PERMISSION_MANAGE')
    if (!guarded.ok) return guarded.response
    const { shopId, principal, session } = guarded
    if (!shopId || !principal) return serverError()
    if (principal.memberKind !== 'SHOP_OWNER') return forbidden("Lavozimlarni faqat do'kon egasi yaratadi")

    const parsed = createShopStaffRoleSchema.safeParse(await readLimitedJsonBody(request))
    if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? "Lavozim ma'lumoti noto'g'ri")
    const permissionCodes = rolePermissionCodesWithLogs(parsed.data.permissionCodes, parsed.data.logsViewEnabled)
    const permissionMessage = validateRolePermissions(permissionCodes)
    if (permissionMessage) return badRequest(permissionMessage)

    const role = await runSerializable(() => prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Shop" WHERE "id" = ${shopId} FOR UPDATE`)
      const livePrincipal = await getLiveShopPrincipalForMutation(tx, {
        shopId,
        actorId: session.user.id,
      })
      if (
        !livePrincipal || livePrincipal.memberKind !== 'SHOP_OWNER' ||
        !principalHasPermission(livePrincipal, 'STAFF_PERMISSION_MANAGE')
      ) {
        throw Object.assign(new Error('AUTHORIZATION_CHANGED'), { code: 'AUTHORIZATION_CHANGED' })
      }
      const livePermissionMessage = validateRolePermissions(permissionCodes)
      if (livePermissionMessage) {
        throw Object.assign(new Error(livePermissionMessage), { code: 'PERMISSION_INVALID' })
      }
      const existingCustomRoles = await tx.shopStaffRole.findMany({
        where: { shopId, kind: SHOP_STAFF_ROLE_KIND.CUSTOM, isArchived: false },
        select: { id: true },
        take: MAX_CUSTOM_STAFF_ROLES,
      })
      if (existingCustomRoles.length >= MAX_CUSTOM_STAFF_ROLES) {
        throw Object.assign(new Error('ROLE_LIMIT'), { code: 'ROLE_LIMIT' })
      }

      const createdRole = await tx.shopStaffRole.create({
        data: {
          shopId,
          name: parsed.data.name,
          normalizedName: normalizedRoleName(parsed.data.name),
          description: parsed.data.description || null,
          kind: SHOP_STAFF_ROLE_KIND.CUSTOM,
          createdById: session.user.id,
          updatedById: session.user.id,
        },
        select: { id: true, name: true, description: true },
      })
      if (permissionCodes.length) {
        await tx.shopStaffRolePermission.createMany({
          data: permissionCodes.map((permissionCode) => ({
            shopId,
            roleId: createdRole.id,
            permissionCode,
          })),
        })
      }
      await tx.log.create({
        data: {
          shopId,
          actorId: session.user.id,
          actorType: 'SHOP_ADMIN',
          action: 'STAFF_ROLE_CREATE',
          targetType: 'ShopStaffRole',
          targetId: createdRole.id,
          newValue: {
            name: createdRole.name,
            description: createdRole.description,
            permissionCodes,
          },
        },
      })
      return tx.shopStaffRole.findUniqueOrThrow({ where: { id: createdRole.id }, select: shopStaffRoleSelect })
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }))

    return created(projectShopStaffRole(role, principal), 'Lavozim yaratildi')
  } catch (error) {
    if (isRequestBodyTooLarge(error)) return payloadTooLarge()
    if (isInvalidRequestBody(error)) return badRequest("So'rov ma'lumoti noto'g'ri")
    if (error && typeof error === 'object' && 'code' in error) {
      if (error.code === 'AUTHORIZATION_CHANGED') return forbidden("Ruxsatlaringiz o'zgargan. Sahifani yangilang")
      if (error.code === 'PERMISSION_INVALID') return badRequest("Tanlangan ruxsat noto'g'ri")
      if (error.code === 'ROLE_LIMIT') return conflict(`Ko'pi bilan ${MAX_CUSTOM_STAFF_ROLES} ta faol maxsus lavozim yaratish mumkin`)
      if (error.code === 'P2002') return conflict('Bu nomdagi faol lavozim allaqachon mavjud')
    }
    if (error instanceof Error && error.message === 'SERIALIZABLE_TRANSACTION_FAILED') {
      return serverError("Amalni yakunlab bo'lmadi. Qayta urinib ko'ring")
    }
    logger.error('[POST /api/shop/staff/roles]', { event: 'api.route_error', error })
    return serverError()
  }
}
