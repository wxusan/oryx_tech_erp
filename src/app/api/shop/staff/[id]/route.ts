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
  withNasiyaArchivePermissionBundle,
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
import {
  processDueTelegramDisableTransitions,
  purgeTelegramIdentityInTransaction,
  TELEGRAM_PURGE_REASON,
  telegramPreassignmentAllowed,
} from '@/lib/server/telegram-lifecycle'

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
    const requestedPermissionCodes = parsed.data.permissionCodes === undefined
      ? undefined
      : withNasiyaArchivePermissionBundle(parsed.data.permissionCodes)
    if (parsed.data.staffId === principal.actorId) return conflict("O'z profilingizni xodim boshqaruvi orqali o'zgartirib bo'lmaydi")
    if (parsed.data.login !== undefined && principal.memberKind !== 'SHOP_OWNER') {
      return forbidden("Xodim loginini faqat do'kon egasi o'zgartira oladi")
    }

    const requiredPermissions: Array<[boolean, ShopPermissionCode]> = [
      [parsed.data.name !== undefined || parsed.data.phone !== undefined, 'STAFF_EDIT_PROFILE'],
      [parsed.data.password !== undefined, 'STAFF_RESET_PASSWORD'],
      [parsed.data.isActive !== undefined, 'STAFF_STATUS_MANAGE'],
      [parsed.data.permissionCodes !== undefined || parsed.data.logsViewEnabled !== undefined || parsed.data.roleId !== undefined, 'STAFF_PERMISSION_MANAGE'],
      [parsed.data.telegramNotificationsEnabled !== undefined, 'STAFF_NOTIFICATION_MANAGE'],
    ]
    for (const [included, permission] of requiredPermissions) {
      if (included && !principalHasPermission(principal, permission)) {
        return forbidden("So'rovdagi barcha o'zgarishlar uchun alohida ruxsat kerak")
      }
    }

    if (requestedPermissionCodes) {
      const permissionMessage = validatePermissions(requestedPermissionCodes, principal.enabledFeatures)
      if (permissionMessage) return badRequest(permissionMessage)
      if (
        principal.memberKind === 'SHOP_STAFF' &&
        requestedPermissionCodes.some((code) => (
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
    if (parsed.data.telegramNotificationsEnabled === true) {
      await processDueTelegramDisableTransitions({ shopId, limit: 100 })
    }
    if (
      parsed.data.telegramNotificationsEnabled === true &&
      !(await telegramPreassignmentAllowed(prisma, shopId))
    ) {
      return badRequest("Telegram funksiyasi do'kon uchun yoqilmagan")
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
          login: true,
          isActive: true,
          name: true,
          legacyFullAccess: true,
          staffRoleId: true,
          roleVersionApplied: true,
          permissions: { select: { permissionCode: true } },
        },
      })
      if (!target) throw Object.assign(new Error('STAFF_NOT_FOUND'), { code: 'STAFF_NOT_FOUND' })
      if (shop?.ownerAdminId === id) throw Object.assign(new Error('OWNER_TARGET'), { code: 'OWNER_TARGET' })
      if (parsed.data.login !== undefined && livePrincipal.memberKind !== 'SHOP_OWNER') {
        throw Object.assign(new Error('LOGIN_OWNER_ONLY'), { code: 'LOGIN_OWNER_ONLY' })
      }

      const loginChanged = parsed.data.login !== undefined && parsed.data.login !== target.login
      if (loginChanged) {
        const existingLogin = await tx.shopAdmin.findUnique({
          where: { login: parsed.data.login },
          select: { id: true },
        })
        if (existingLogin && existingLogin.id !== id) {
          throw Object.assign(new Error('LOGIN_TAKEN'), { code: 'LOGIN_TAKEN' })
        }
      }

      const activeFeatures = livePrincipal.enabledFeatures
      if (requestedPermissionCodes) {
        const livePermissionMessage = validatePermissions(requestedPermissionCodes, activeFeatures)
        if (livePermissionMessage) {
          throw Object.assign(new Error(livePermissionMessage), { code: 'PERMISSION_INVALID' })
        }
        if (
          livePrincipal.memberKind === 'SHOP_STAFF' &&
          requestedPermissionCodes.some((code) => (
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
      if (
        parsed.data.telegramNotificationsEnabled === true &&
        !(await telegramPreassignmentAllowed(tx, shopId))
      ) {
        throw Object.assign(new Error('TELEGRAM_DISABLED'), { code: 'TELEGRAM_DISABLED' })
      }
      const selectedRole = parsed.data.roleId
        ? await tx.shopStaffRole.findFirst({
            where: { id: parsed.data.roleId, shopId, isArchived: false },
            select: {
              id: true,
              name: true,
              version: true,
              permissions: { select: { permissionCode: true } },
            },
          })
        : null
      if (parsed.data.roleId && !selectedRole) {
        throw Object.assign(new Error('ROLE_NOT_FOUND'), { code: 'ROLE_NOT_FOUND' })
      }
      const selectedRolePermissionCodes = selectedRole?.permissions
        .map((permission) => permission.permissionCode as ShopPermissionCode) ?? []
      if (selectedRolePermissionCodes.some((code) => {
        const permission = SHOP_PERMISSION_CATALOG.find((item) => item.code === code)
        return !permission || permission.retired || permission.ownerOnly
      })) {
        throw Object.assign(new Error('PERMISSION_INVALID'), { code: 'PERMISSION_INVALID' })
      }
      if (
        selectedRole && livePrincipal.memberKind === 'SHOP_STAFF' &&
        selectedRolePermissionCodes.some((code) => (
          !SHOP_PERMISSION_CATALOG.find((item) => item.code === code)?.staffManagerDelegable
        ))
      ) {
        throw Object.assign(new Error('DELEGATION_FORBIDDEN'), { code: 'DELEGATION_FORBIDDEN' })
      }
      const permissionSnapshotChanged = parsed.data.permissionCodes !== undefined ||
        parsed.data.logsViewEnabled !== undefined || parsed.data.roleId !== undefined
      const existingPermissionCodes = withNasiyaArchivePermissionBundle(target.legacyFullAccess
        ? legacyStaffPermissionCodes(activeFeatures)
        : [...expandShopPermissionCodes(target.permissions.map((item) => item.permissionCode))]
            .filter(isActiveShopPermissionCode))
      if (
        selectedRole && livePrincipal.memberKind === 'SHOP_STAFF' &&
        existingPermissionCodes.some((code) => (
          !SHOP_PERMISSION_CATALOG.find((item) => item.code === code)?.staffManagerDelegable
        ))
      ) {
        throw Object.assign(new Error('DELEGATION_FORBIDDEN'), { code: 'DELEGATION_FORBIDDEN' })
      }
      const nextPermissionCodes = selectedRole
        ? selectedRolePermissionCodes
        : withNasiyaArchivePermissionBundle(
          livePrincipal.memberKind === 'SHOP_OWNER'
          ? withStaffLogsPermission(
              requestedPermissionCodes ?? existingPermissionCodes.filter((code) => code !== STAFF_LOGS_PERMISSION),
              parsed.data.logsViewEnabled ?? existingPermissionCodes.includes(STAFF_LOGS_PERMISSION),
            )
          : [
            ...existingPermissionCodes.filter((code) => (
              !SHOP_PERMISSION_CATALOG.find((item) => item.code === code)?.staffManagerDelegable
            )),
            ...(requestedPermissionCodes ?? existingPermissionCodes.filter((code) => (
              SHOP_PERMISSION_CATALOG.find((item) => item.code === code)?.staffManagerDelegable
            ))),
          ],
        )
      const sessionAffectingChange = parsed.data.isActive !== undefined ||
        passwordHash !== undefined || loginChanged || permissionSnapshotChanged ||
        parsed.data.telegramNotificationsEnabled !== undefined

      await tx.shopAdmin.update({
        where: { id },
        data: {
          name: parsed.data.name,
          phone: parsed.data.phone,
          login: parsed.data.login,
          isActive: parsed.data.isActive,
          telegramNotificationsEnabled: parsed.data.telegramNotificationsEnabled,
          passwordHash,
          passwordChangedAt: passwordHash ? new Date() : undefined,
          permissionVersion: permissionSnapshotChanged ? { increment: 1 } : undefined,
          legacyFullAccess: permissionSnapshotChanged ? false : undefined,
          staffRoleId: parsed.data.roleId !== undefined
            ? parsed.data.roleId
            : permissionSnapshotChanged
              ? null
              : undefined,
          roleVersionApplied: selectedRole
            ? selectedRole.version
            : permissionSnapshotChanged
              ? null
              : undefined,
          sessionVersion: sessionAffectingChange ? { increment: 1 } : undefined,
        },
      })

      if (parsed.data.telegramNotificationsEnabled === false || parsed.data.isActive === false) {
        await purgeTelegramIdentityInTransaction(
          tx,
          { type: 'SHOP_ADMIN', shopId, shopAdminId: id },
          {
            reason: parsed.data.telegramNotificationsEnabled === false
              ? TELEGRAM_PURGE_REASON.STAFF_DISABLED
              : TELEGRAM_PURGE_REASON.ACCOUNT_INACTIVE,
            disablePersonalNotifications: parsed.data.telegramNotificationsEnabled === false,
          },
        )
      }

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
            login: target.login,
            isActive: target.isActive,
            legacyFullAccess: target.legacyFullAccess,
            permissionCodes: target.permissions.map((item) => item.permissionCode),
            roleId: target.staffRoleId,
            roleVersionApplied: target.roleVersionApplied,
            logsViewEnabled: existingPermissionCodes.includes(STAFF_LOGS_PERMISSION),
          },
          newValue: {
            name: parsed.data.name,
            login: parsed.data.login,
            isActive: parsed.data.isActive,
            permissionCodes: nextPermissionCodes,
            roleId: parsed.data.roleId !== undefined
              ? parsed.data.roleId
              : permissionSnapshotChanged
                ? null
                : target.staffRoleId,
            roleVersionApplied: selectedRole?.version ?? (permissionSnapshotChanged ? null : target.roleVersionApplied),
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
      if (error.code === 'OWNER_TARGET') return conflict('Tanlangan foydalanuvchini do‘kon egasi sifatida biriktirib bo‘lmaydi.')
      if (error.code === 'STAFF_ACCESS_DISABLED') return conflict('Xodimlar uchun kirish o‘chirilgan.')
      if (error.code === 'AUTHORIZATION_CHANGED') return forbidden('Ruxsatlaringiz o‘zgargan. Sahifani yangilab, qayta urinib ko‘ring.')
      if (error.code === 'PERMISSION_INVALID') return badRequest('Tanlangan ruxsat noto‘g‘ri.')
      if (error.code === 'ROLE_NOT_FOUND') return badRequest('Tanlangan lavozim topilmadi yoki arxivlangan.')
      if (error.code === 'DELEGATION_FORBIDDEN') return forbidden('Bu amalni boshqa foydalanuvchi nomidan bajarishga ruxsat yo‘q.')
      if (error.code === 'LOGS_OWNER_ONLY') return forbidden('Faoliyat tarixini faqat do‘kon egasi ko‘ra oladi.')
      if (error.code === 'LOGIN_OWNER_ONLY') return forbidden('Tizimga faqat do‘kon egasi kira oladi.')
      if (error.code === 'LOGIN_TAKEN') return conflict('Bu login allaqachon band.')
      if (error.code === 'TELEGRAM_DISABLED') return badRequest('Telegram funksiyasi o‘chirilgan.')
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
      await purgeTelegramIdentityInTransaction(
        tx,
        { type: 'SHOP_ADMIN', shopId, shopAdminId: id },
        { reason: TELEGRAM_PURGE_REASON.ACCOUNT_DELETED },
      )
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
      if (error.code === 'OWNER_TARGET') return conflict('Tanlangan foydalanuvchini do‘kon egasi sifatida biriktirib bo‘lmaydi.')
      if (error.code === 'AUTHORIZATION_CHANGED') return forbidden('Ruxsatlaringiz o‘zgargan. Sahifani yangilab, qayta urinib ko‘ring.')
    }
    if (error instanceof Error && error.message === 'SERIALIZABLE_TRANSACTION_FAILED') return serverError('Amalni yakunlab bo‘lmadi. Iltimos, qayta urinib ko‘ring.')
    logger.error('[DELETE /api/shop/staff/[id]]', { event: 'api.route_error', error })
    return serverError()
  }
}
