import { NextRequest } from 'next/server'
import { Prisma } from '@/generated/prisma/client'
import { requireCurrentShopPermission } from '@/lib/api-auth'
import { badRequest, conflict, forbidden, notFound, ok, payloadTooLarge, serverError } from '@/lib/api-helpers'
import {
  SHOP_PERMISSION_CATALOG,
  type ShopPermissionCode,
} from '@/lib/access-control'
import { prisma } from '@/lib/prisma'
import {
  archiveShopStaffRoleSchema,
  normalizedRoleName,
  rolePermissionCodesWithLogs,
  updateShopStaffRoleSchema,
} from '@/lib/shop-staff-role-contract'
import { STAFF_LOGS_PERMISSION } from '@/lib/shop-staff-contract'
import {
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

type RouteContext = { params: Promise<{ roleId: string }> }

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

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const guarded = await requireCurrentShopPermission('STAFF_PERMISSION_MANAGE')
    if (!guarded.ok) return guarded.response
    const { shopId, principal, session } = guarded
    if (!shopId || !principal) return serverError()
    if (principal.memberKind !== 'SHOP_OWNER') return forbidden("Lavozimlarni faqat do'kon egasi tahrirlaydi")

    const { roleId } = await context.params
    const parsed = updateShopStaffRoleSchema.safeParse(await readLimitedJsonBody(request))
    if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? "Lavozim ma'lumoti noto'g'ri")

    const updatedRole = await runSerializable(() => prisma.$transaction(async (tx) => {
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

      const existing = await tx.shopStaffRole.findFirst({
        where: { id: roleId, shopId },
        select: shopStaffRoleSelect,
      })
      if (!existing) throw Object.assign(new Error('ROLE_NOT_FOUND'), { code: 'ROLE_NOT_FOUND' })
      if (existing.kind === SHOP_STAFF_ROLE_KIND.BUILT_IN) {
        throw Object.assign(new Error('BUILT_IN_IMMUTABLE'), { code: 'BUILT_IN_IMMUTABLE' })
      }
      if (existing.isArchived) throw Object.assign(new Error('ROLE_ARCHIVED'), { code: 'ROLE_ARCHIVED' })
      if (existing.version !== parsed.data.version) {
        throw Object.assign(new Error('VERSION_CONFLICT'), { code: 'VERSION_CONFLICT' })
      }

      const existingCodes = existing.permissions.map((permission) => permission.permissionCode)
      const nextCodes = rolePermissionCodesWithLogs(
        parsed.data.permissionCodes ?? existingCodes.filter((code) => code !== STAFF_LOGS_PERMISSION) as ShopPermissionCode[],
        parsed.data.logsViewEnabled ?? existingCodes.includes(STAFF_LOGS_PERMISSION),
      )
      const permissionsChanged = [...new Set(nextCodes)].sort().join('\u0000') !==
        [...new Set(existingCodes)].sort().join('\u0000')
      const permissionMessage = validateRolePermissions(nextCodes)
      if (permissionMessage) {
        throw Object.assign(new Error(permissionMessage), { code: 'PERMISSION_INVALID' })
      }
      const nextVersion = existing.version + 1

      await tx.shopStaffRole.update({
        where: { id: roleId },
        data: {
          name: parsed.data.name,
          normalizedName: parsed.data.name ? normalizedRoleName(parsed.data.name) : undefined,
          description: parsed.data.description === undefined ? undefined : parsed.data.description || null,
          updatedById: session.user.id,
          version: nextVersion,
        },
      })

      let affectedMembers = 0
      if (permissionsChanged) {
        await tx.shopStaffRolePermission.deleteMany({ where: { roleId, shopId } })
        if (nextCodes.length) {
          await tx.shopStaffRolePermission.createMany({
            data: nextCodes.map((permissionCode) => ({ shopId, roleId, permissionCode })),
          })
        }

        await tx.$executeRaw(Prisma.sql`
          DELETE FROM "ShopMemberPermission" grant_row
          USING "ShopAdmin" member
          WHERE grant_row."shopAdminId" = member."id"
            AND grant_row."shopId" = ${shopId}
            AND member."shopId" = ${shopId}
            AND member."staffRoleId" = ${roleId}
        `)
        if (nextCodes.length) {
          await tx.$executeRaw(Prisma.sql`
            INSERT INTO "ShopMemberPermission" (
              "id", "shopId", "shopAdminId", "permissionCode", "grantedAt", "grantedById"
            )
            SELECT
              'rolegrant_' || md5(${roleId} || ':' || member."id" || ':' || role_permission."permissionCode"),
              ${shopId},
              member."id",
              role_permission."permissionCode",
              CURRENT_TIMESTAMP,
              ${session.user.id}
            FROM "ShopAdmin" member
            JOIN "ShopStaffRolePermission" role_permission
              ON role_permission."roleId" = ${roleId}
             AND role_permission."shopId" = ${shopId}
            WHERE member."shopId" = ${shopId}
              AND member."staffRoleId" = ${roleId}
              AND member."deletedAt" IS NULL
            ON CONFLICT ("shopAdminId", "permissionCode") DO NOTHING
          `)
        }
        affectedMembers = await tx.$executeRaw(Prisma.sql`
          UPDATE "ShopAdmin"
          SET "permissionVersion" = "permissionVersion" + 1,
              "sessionVersion" = "sessionVersion" + 1,
              "roleVersionApplied" = ${nextVersion},
              "legacyFullAccess" = false
          WHERE "shopId" = ${shopId}
            AND "staffRoleId" = ${roleId}
            AND "deletedAt" IS NULL
        `)
        await tx.$executeRaw(Prisma.sql`
          UPDATE "AuthSession" session
          SET "revokedAt" = CURRENT_TIMESTAMP
          WHERE session."actorType" = 'SHOP_ADMIN'
            AND session."shopId" = ${shopId}
            AND session."revokedAt" IS NULL
            AND EXISTS (
              SELECT 1 FROM "ShopAdmin" member
              WHERE member."id" = session."actorId"
                AND member."shopId" = ${shopId}
                AND member."staffRoleId" = ${roleId}
            )
        `)
        if (affectedMembers > 0) {
          await tx.shop.update({ where: { id: shopId }, data: { authorizationVersion: { increment: 1 } } })
        }
      } else {
        affectedMembers = await tx.$executeRaw(Prisma.sql`
          UPDATE "ShopAdmin"
          SET "roleVersionApplied" = ${nextVersion}
          WHERE "shopId" = ${shopId}
            AND "staffRoleId" = ${roleId}
            AND "deletedAt" IS NULL
        `)
      }

      await tx.log.create({
        data: {
          shopId,
          actorId: session.user.id,
          actorType: 'SHOP_ADMIN',
          action: 'STAFF_ROLE_UPDATE',
          targetType: 'ShopStaffRole',
          targetId: roleId,
          oldValue: {
            name: existing.name,
            description: existing.description,
            permissionCodes: existingCodes,
            version: existing.version,
          },
          newValue: {
            name: parsed.data.name ?? existing.name,
            description: parsed.data.description === undefined ? existing.description : parsed.data.description || null,
            permissionCodes: nextCodes,
            version: nextVersion,
            permissionsChanged,
            affectedMembers,
          },
          note: parsed.data.note,
        },
      })

      return tx.shopStaffRole.findUniqueOrThrow({ where: { id: roleId }, select: shopStaffRoleSelect })
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }))

    return ok(projectShopStaffRole(updatedRole, principal), 'Lavozim yangilandi')
  } catch (error) {
    if (isRequestBodyTooLarge(error)) return payloadTooLarge()
    if (isInvalidRequestBody(error)) return badRequest("So'rov ma'lumoti noto'g'ri")
    if (error && typeof error === 'object' && 'code' in error) {
      if (error.code === 'ROLE_NOT_FOUND') return notFound('Lavozim topilmadi')
      if (error.code === 'BUILT_IN_IMMUTABLE') return conflict("Standart lavozimni o'zgartirib bo'lmaydi; nusxa yarating")
      if (error.code === 'ROLE_ARCHIVED') return conflict('Bu lavozim arxivlangan')
      if (error.code === 'VERSION_CONFLICT') return conflict("Lavozim boshqa oynada o'zgargan. Sahifani yangilang")
      if (error.code === 'AUTHORIZATION_CHANGED') return forbidden("Ruxsatlaringiz o'zgargan. Sahifani yangilang")
      if (error.code === 'PERMISSION_INVALID') return badRequest("Tanlangan ruxsat noto'g'ri")
      if (error.code === 'P2002') return conflict('Bu nomdagi faol lavozim allaqachon mavjud')
    }
    if (error instanceof Error && error.message === 'SERIALIZABLE_TRANSACTION_FAILED') {
      return serverError("Amalni yakunlab bo'lmadi. Qayta urinib ko'ring")
    }
    logger.error('[PATCH /api/shop/staff/roles/[roleId]]', { event: 'api.route_error', error })
    return serverError()
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const guarded = await requireCurrentShopPermission('STAFF_PERMISSION_MANAGE')
    if (!guarded.ok) return guarded.response
    const { shopId, principal, session } = guarded
    if (!shopId || !principal) return serverError()
    if (principal.memberKind !== 'SHOP_OWNER') return forbidden("Lavozimlarni faqat do'kon egasi arxivlaydi")
    const { roleId } = await context.params
    const parsed = archiveShopStaffRoleSchema.safeParse(await readLimitedJsonBody(request))
    if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? 'Arxivlash sababi noto‘g‘ri')

    await runSerializable(() => prisma.$transaction(async (tx) => {
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
      const existing = await tx.shopStaffRole.findFirst({
        where: { id: roleId, shopId },
        select: shopStaffRoleSelect,
      })
      if (!existing) throw Object.assign(new Error('ROLE_NOT_FOUND'), { code: 'ROLE_NOT_FOUND' })
      if (existing.kind === SHOP_STAFF_ROLE_KIND.BUILT_IN) {
        throw Object.assign(new Error('BUILT_IN_IMMUTABLE'), { code: 'BUILT_IN_IMMUTABLE' })
      }
      if (existing.isArchived) throw Object.assign(new Error('ROLE_ARCHIVED'), { code: 'ROLE_ARCHIVED' })
      if (existing.version !== parsed.data.version) {
        throw Object.assign(new Error('VERSION_CONFLICT'), { code: 'VERSION_CONFLICT' })
      }
      await tx.shopStaffRole.update({
        where: { id: roleId },
        data: {
          isArchived: true,
          version: { increment: 1 },
          updatedById: session.user.id,
        },
      })
      await tx.shopAdmin.updateMany({
        where: { shopId, staffRoleId: roleId, deletedAt: null },
        data: { roleVersionApplied: existing.version + 1 },
      })
      await tx.log.create({
        data: {
          shopId,
          actorId: session.user.id,
          actorType: 'SHOP_ADMIN',
          action: 'STAFF_ROLE_ARCHIVE',
          targetType: 'ShopStaffRole',
          targetId: roleId,
          oldValue: {
            name: existing.name,
            permissionCodes: existing.permissions.map((permission) => permission.permissionCode),
            version: existing.version,
          },
          newValue: { isArchived: true, version: existing.version + 1 },
          note: parsed.data.note,
        },
      })
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }))

    return ok({ id: roleId }, 'Lavozim arxivlandi. Biriktirilgan xodimlar ruxsatlari saqlandi')
  } catch (error) {
    if (isRequestBodyTooLarge(error)) return payloadTooLarge()
    if (isInvalidRequestBody(error)) return badRequest("So'rov ma'lumoti noto'g'ri")
    if (error && typeof error === 'object' && 'code' in error) {
      if (error.code === 'ROLE_NOT_FOUND') return notFound('Lavozim topilmadi')
      if (error.code === 'BUILT_IN_IMMUTABLE') return conflict('Standart lavozimni arxivlab bo‘lmaydi')
      if (error.code === 'ROLE_ARCHIVED') return conflict('Bu lavozim allaqachon arxivlangan')
      if (error.code === 'VERSION_CONFLICT') return conflict("Lavozim boshqa oynada o'zgargan. Sahifani yangilang")
      if (error.code === 'AUTHORIZATION_CHANGED') return forbidden("Ruxsatlaringiz o'zgargan. Sahifani yangilang")
    }
    if (error instanceof Error && error.message === 'SERIALIZABLE_TRANSACTION_FAILED') {
      return serverError("Amalni yakunlab bo'lmadi. Qayta urinib ko'ring")
    }
    logger.error('[DELETE /api/shop/staff/roles/[roleId]]', { event: 'api.route_error', error })
    return serverError()
  }
}
