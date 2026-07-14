import { NextRequest } from 'next/server'
import bcrypt from 'bcrypt'
import { Prisma } from '@/generated/prisma/client'
import { requireCurrentShopAnyPermission, requireCurrentShopPermission } from '@/lib/api-auth'
import { badRequest, conflict, forbidden, notFound, ok, payloadTooLarge, serverError } from '@/lib/api-helpers'
import {
  SHOP_PERMISSION_CATALOG,
  expandShopPermissionCodes,
  isActiveShopPermissionCode,
  permissionRequiredFeatures,
  type ShopPermissionCode,
} from '@/lib/access-control'
import { prisma } from '@/lib/prisma'
import { getLiveShopPrincipalForMutation, principalHasPermission } from '@/lib/server/shop-access'
import {
  deleteShopStaffSchema,
  legacyStaffPermissionCodes,
  STAFF_LOGS_PERMISSION,
  updateShopStaffSchema,
  withStaffLogsPermission,
} from '@/lib/shop-staff-contract'
import { projectShopStaff, shopStaffProjectionSelect } from '@/lib/server/shop-staff-projection'
import {
  isInvalidRequestBody,
  isRequestBodyTooLarge,
  readLimitedJsonBody,
} from '@/lib/server/request-limits'
import { isRetryableTransactionError } from '@/lib/server/transaction-retry'
import { logger } from '@/lib/logger'

type RouteContext = { params: Promise<{ id: string }> }

const STAFF_UPDATE_PERMISSIONS = [
  'STAFF_EDIT_PROFILE',
  'STAFF_RESET_PASSWORD',
  'STAFF_STATUS_MANAGE',
  'STAFF_PERMISSION_MANAGE',
  'STAFF_NOTIFICATION_MANAGE',
] as const satisfies readonly ShopPermissionCode[]

function validatePermissions(
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

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const guarded = await requireCurrentShopAnyPermission(STAFF_UPDATE_PERMISSIONS)
    if (!guarded.ok) return guarded.response
    const { shopId, principal, session } = guarded
    if (!shopId || !principal) return serverError()

    const { id } = await context.params
    const body = await readLimitedJsonBody(request)
    const parsed = updateShopStaffSchema.safeParse({ ...(body as object), staffId: id })
    if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? "Xodim ma'lumoti noto'g'ri")
    if (parsed.data.staffId === principal.actorId) return conflict("O'z profilingizni xodim boshqaruvi orqali o'zgartirib bo'lmaydi")

    const requiredPermissions: Array<[boolean, ShopPermissionCode]> = [
      [parsed.data.name !== undefined || parsed.data.phone !== undefined, 'STAFF_EDIT_PROFILE'],
      [parsed.data.password !== undefined, 'STAFF_RESET_PASSWORD'],
      [parsed.data.isActive !== undefined, 'STAFF_STATUS_MANAGE'],
      [parsed.data.permissionCodes !== undefined || parsed.data.logsViewEnabled !== undefined, 'STAFF_PERMISSION_MANAGE'],
      [parsed.data.telegramNotificationsEnabled !== undefined, 'STAFF_NOTIFICATION_MANAGE'],
    ]
    for (const [included, permission] of requiredPermissions) {
      if (included && !principalHasPermission(principal, permission)) {
        return forbidden("So'rovdagi barcha o'zgarishlar uchun alohida ruxsat kerak")
      }
    }

    if (parsed.data.permissionCodes) {
      const permissionMessage = validatePermissions(parsed.data.permissionCodes, principal.enabledFeatures)
      if (permissionMessage) return badRequest(permissionMessage)
      if (
        principal.memberKind === 'SHOP_STAFF' &&
        parsed.data.permissionCodes.some((code) => (
          !SHOP_PERMISSION_CATALOG.find((item) => item.code === code)?.staffManagerDelegable
        ))
      ) {
        return forbidden("Xodim boshqaruvchisi faqat oddiy operatsion ruxsatlarni bera oladi")
      }
    }
    if (principal.memberKind === 'SHOP_STAFF' && parsed.data.logsViewEnabled !== undefined) {
      return forbidden("Log ruxsatini faqat do'kon egasi boshqaradi")
    }
    if (parsed.data.telegramNotificationsEnabled === true && !principal.enabledFeatures.has('TELEGRAM')) {
      return badRequest("Telegram moduli yoqilmagani uchun bildirishnomalarni yoqib bo'lmaydi")
    }
    const passwordHash = parsed.data.password ? await bcrypt.hash(parsed.data.password, 12) : undefined

    const row = await runSerializable(() => prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Shop" WHERE "id" = ${shopId} FOR UPDATE`)
      const livePrincipal = await getLiveShopPrincipalForMutation(tx, {
        shopId,
        actorId: session.user.id,
      })
      if (!livePrincipal) {
        throw Object.assign(new Error('AUTHORIZATION_CHANGED'), { code: 'AUTHORIZATION_CHANGED' })
      }
      for (const [included, permission] of requiredPermissions) {
        if (included && !principalHasPermission(livePrincipal, permission)) {
          throw Object.assign(new Error('AUTHORIZATION_CHANGED'), { code: 'AUTHORIZATION_CHANGED' })
        }
      }
      const shop = await tx.shop.findUnique({ where: { id: shopId }, select: { ownerAdminId: true } })
      const target = await tx.shopAdmin.findFirst({
        where: { id, shopId, deletedAt: null },
        select: {
          id: true,
          isActive: true,
          name: true,
          legacyFullAccess: true,
          permissions: { select: { permissionCode: true } },
        },
      })
      if (!target) throw Object.assign(new Error('STAFF_NOT_FOUND'), { code: 'STAFF_NOT_FOUND' })
      if (shop?.ownerAdminId === id) throw Object.assign(new Error('OWNER_TARGET'), { code: 'OWNER_TARGET' })

      const activeFeatures = livePrincipal.enabledFeatures
      if (parsed.data.permissionCodes) {
        const livePermissionMessage = validatePermissions(parsed.data.permissionCodes, activeFeatures)
        if (livePermissionMessage) {
          throw Object.assign(new Error(livePermissionMessage), { code: 'PERMISSION_INVALID' })
        }
        if (
          livePrincipal.memberKind === 'SHOP_STAFF' &&
          parsed.data.permissionCodes.some((code) => (
            !SHOP_PERMISSION_CATALOG.find((item) => item.code === code)?.staffManagerDelegable
          ))
        ) {
          throw Object.assign(new Error('DELEGATION_FORBIDDEN'), { code: 'DELEGATION_FORBIDDEN' })
        }
      }
      if (livePrincipal.memberKind === 'SHOP_STAFF' && parsed.data.logsViewEnabled !== undefined) {
        throw Object.assign(new Error('LOGS_OWNER_ONLY'), { code: 'LOGS_OWNER_ONLY' })
      }
      if (parsed.data.telegramNotificationsEnabled === true && !activeFeatures.has('TELEGRAM')) {
        throw Object.assign(new Error('TELEGRAM_DISABLED'), { code: 'TELEGRAM_DISABLED' })
      }
      const permissionSnapshotChanged = parsed.data.permissionCodes !== undefined || parsed.data.logsViewEnabled !== undefined
      const existingPermissionCodes = target.legacyFullAccess
        ? legacyStaffPermissionCodes(activeFeatures)
        : [...expandShopPermissionCodes(target.permissions.map((item) => item.permissionCode))]
            .filter(isActiveShopPermissionCode)
      const nextPermissionCodes = livePrincipal.memberKind === 'SHOP_OWNER'
        ? withStaffLogsPermission(
            parsed.data.permissionCodes ?? existingPermissionCodes.filter((code) => code !== STAFF_LOGS_PERMISSION),
            parsed.data.logsViewEnabled ?? existingPermissionCodes.includes(STAFF_LOGS_PERMISSION),
          )
        : [
            ...existingPermissionCodes.filter((code) => (
              !SHOP_PERMISSION_CATALOG.find((item) => item.code === code)?.staffManagerDelegable
            )),
            ...(parsed.data.permissionCodes ?? existingPermissionCodes.filter((code) => (
              SHOP_PERMISSION_CATALOG.find((item) => item.code === code)?.staffManagerDelegable
            ))),
          ]
      const sessionAffectingChange = parsed.data.isActive !== undefined ||
        passwordHash !== undefined || permissionSnapshotChanged ||
        parsed.data.telegramNotificationsEnabled !== undefined

      await tx.shopAdmin.update({
        where: { id },
        data: {
          name: parsed.data.name,
          phone: parsed.data.phone,
          isActive: parsed.data.isActive,
          telegramNotificationsEnabled: parsed.data.telegramNotificationsEnabled,
          passwordHash,
          passwordChangedAt: passwordHash ? new Date() : undefined,
          permissionVersion: permissionSnapshotChanged ? { increment: 1 } : undefined,
          legacyFullAccess: permissionSnapshotChanged ? false : undefined,
          sessionVersion: sessionAffectingChange ? { increment: 1 } : undefined,
        },
      })

      if (permissionSnapshotChanged) {
        await tx.shopMemberPermission.deleteMany({ where: { shopAdminId: id, shopId } })
        if (nextPermissionCodes.length) {
          await tx.shopMemberPermission.createMany({
            data: nextPermissionCodes.map((permissionCode) => ({
              shopId,
              shopAdminId: id,
              permissionCode,
              grantedById: session.user.id,
            })),
          })
        }
      }

      if (sessionAffectingChange) {
        await tx.authSession.updateMany({
          where: { actorType: 'SHOP_ADMIN', actorId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        })
      }
      await tx.shop.update({ where: { id: shopId }, data: { authorizationVersion: { increment: 1 } } })
      await tx.log.create({
        data: {
          shopId,
          actorId: session.user.id,
          actorType: 'SHOP_ADMIN',
          action: 'STAFF_UPDATE',
          targetType: 'ShopAdmin',
          targetId: id,
          oldValue: {
            name: target.name,
            isActive: target.isActive,
            legacyFullAccess: target.legacyFullAccess,
            permissionCodes: target.permissions.map((item) => item.permissionCode),
            logsViewEnabled: existingPermissionCodes.includes(STAFF_LOGS_PERMISSION),
          },
          newValue: {
            name: parsed.data.name,
            isActive: parsed.data.isActive,
            permissionCodes: nextPermissionCodes,
            logsViewEnabled: nextPermissionCodes.includes(STAFF_LOGS_PERMISSION),
            legacyFullAccess: permissionSnapshotChanged ? false : target.legacyFullAccess,
            telegramNotificationsEnabled: parsed.data.telegramNotificationsEnabled,
            passwordReset: Boolean(passwordHash),
          },
          note: parsed.data.note,
        },
      })

      return tx.shopAdmin.findUniqueOrThrow({ where: { id }, select: shopStaffProjectionSelect })
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }))

    return ok(projectShopStaff(row, principal), "Xodim profili yangilandi")
  } catch (error) {
    if (isRequestBodyTooLarge(error)) return payloadTooLarge()
    if (isInvalidRequestBody(error)) return badRequest("So'rov ma'lumoti noto'g'ri")
    if (error && typeof error === 'object' && 'code' in error) {
      if (error.code === 'STAFF_NOT_FOUND') return notFound('Xodim topilmadi')
      if (error.code === 'OWNER_TARGET') return conflict("Do'kon egasini xodim sifatida o'zgartirib bo'lmaydi")
      if (error.code === 'STAFF_ACCESS_DISABLED') return conflict("Xodimlar profili o'chirilgan")
      if (error.code === 'AUTHORIZATION_CHANGED') return forbidden("Ruxsat o'zgargan. Sahifani yangilang")
      if (error.code === 'PERMISSION_INVALID') return badRequest(error instanceof Error ? error.message : "Ruxsat noto'g'ri")
      if (error.code === 'DELEGATION_FORBIDDEN') return forbidden("Xodim boshqaruvchisi bu ruxsatni bera olmaydi")
      if (error.code === 'LOGS_OWNER_ONLY') return forbidden("Log ruxsatini faqat do'kon egasi boshqaradi")
      if (error.code === 'TELEGRAM_DISABLED') return badRequest("Telegram moduli yoqilmagan")
      if (error.code === 'P2002') return conflict('Bu telefon yoki login allaqachon mavjud')
    }
    logger.error('[PATCH /api/shop/staff/[id]]', { event: 'api.route_error', error })
    return serverError()
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const guarded = await requireCurrentShopPermission('STAFF_DELETE')
    if (!guarded.ok) return guarded.response
    const { shopId, principal, session } = guarded
    if (!shopId || !principal) return serverError()
    const { id } = await context.params
    const parsed = deleteShopStaffSchema.safeParse(await readLimitedJsonBody(request))
    if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? "O'chirish sababi noto'g'ri")
    if (id === principal.actorId) return conflict("O'z profilingizni o'chirib bo'lmaydi")

    await runSerializable(() => prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Shop" WHERE "id" = ${shopId} FOR UPDATE`)
      const livePrincipal = await getLiveShopPrincipalForMutation(tx, {
        shopId,
        actorId: session.user.id,
      })
      if (!livePrincipal || !principalHasPermission(livePrincipal, 'STAFF_DELETE')) {
        throw Object.assign(new Error('AUTHORIZATION_CHANGED'), { code: 'AUTHORIZATION_CHANGED' })
      }
      const shop = await tx.shop.findUnique({ where: { id: shopId }, select: { ownerAdminId: true } })
      const target = await tx.shopAdmin.findFirst({ where: { id, shopId, deletedAt: null }, select: { id: true, name: true } })
      if (!target) throw Object.assign(new Error('STAFF_NOT_FOUND'), { code: 'STAFF_NOT_FOUND' })
      if (shop?.ownerAdminId === id) throw Object.assign(new Error('OWNER_TARGET'), { code: 'OWNER_TARGET' })

      await tx.shopAdmin.update({
        where: { id },
        data: {
          isActive: false,
          deletedAt: new Date(),
          deletedBy: session.user.id,
          deleteNote: parsed.data.note,
          sessionVersion: { increment: 1 },
          permissionVersion: { increment: 1 },
        },
      })
      await tx.authSession.updateMany({
        where: { actorType: 'SHOP_ADMIN', actorId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      })
      await tx.shop.update({ where: { id: shopId }, data: { authorizationVersion: { increment: 1 } } })
      await tx.log.create({
        data: {
          shopId,
          actorId: session.user.id,
          actorType: 'SHOP_ADMIN',
          action: 'STAFF_DELETE',
          targetType: 'ShopAdmin',
          targetId: id,
          oldValue: { name: target.name },
          note: parsed.data.note,
        },
      })
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }))

    return ok({ id }, "Xodim profili o'chirildi")
  } catch (error) {
    if (isRequestBodyTooLarge(error)) return payloadTooLarge()
    if (isInvalidRequestBody(error)) return badRequest("So'rov ma'lumoti noto'g'ri")
    if (error && typeof error === 'object' && 'code' in error) {
      if (error.code === 'STAFF_NOT_FOUND') return notFound('Xodim topilmadi')
      if (error.code === 'OWNER_TARGET') return conflict("Do'kon egasini o'chirib bo'lmaydi")
      if (error.code === 'AUTHORIZATION_CHANGED') return forbidden("Ruxsat o'zgargan. Sahifani yangilang")
    }
    logger.error('[DELETE /api/shop/staff/[id]]', { event: 'api.route_error', error })
    return serverError()
  }
}
