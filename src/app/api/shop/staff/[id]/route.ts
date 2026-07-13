import { NextRequest } from 'next/server'
import bcrypt from 'bcrypt'
import { Prisma } from '@/generated/prisma/client'
import { requireCurrentShopPermission } from '@/lib/api-auth'
import { badRequest, conflict, notFound, ok, payloadTooLarge, serverError } from '@/lib/api-helpers'
import {
  SHOP_PERMISSION_CATALOG,
  type ShopFeatureCode,
  type ShopPermissionCode,
} from '@/lib/access-control'
import { prisma } from '@/lib/prisma'
import { enabledFeatureSet, getActiveShopPackage } from '@/lib/server/shop-access'
import {
  deleteShopStaffSchema,
  legacyStaffPermissionCodes,
  STAFF_LOGS_PERMISSION,
  updateShopStaffSchema,
  type ShopStaffDto,
  withStaffLogsPermission,
} from '@/lib/shop-staff-contract'
import {
  isInvalidRequestBody,
  isRequestBodyTooLarge,
  readLimitedJsonBody,
} from '@/lib/server/request-limits'
import { isRetryableTransactionError } from '@/lib/server/transaction-retry'
import { logger } from '@/lib/logger'

type RouteContext = { params: Promise<{ id: string }> }

const staffSelect = {
  id: true,
  name: true,
  phone: true,
  login: true,
  isActive: true,
  telegramId: true,
  telegramVerifiedAt: true,
  telegramNotificationsEnabled: true,
  legacyFullAccess: true,
  permissionVersion: true,
  createdAt: true,
  permissions: { select: { permissionCode: true } },
} satisfies Prisma.ShopAdminSelect

type StaffRow = Prisma.ShopAdminGetPayload<{ select: typeof staffSelect }>

function staffDto(row: StaffRow, enabledFeatures: ReadonlySet<ShopFeatureCode>): ShopStaffDto {
  const effectivePermissions = row.legacyFullAccess
    ? legacyStaffPermissionCodes(enabledFeatures)
    : row.permissions.map((item) => item.permissionCode as ShopPermissionCode)
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    login: row.login,
    isActive: row.isActive,
    telegramId: row.telegramId,
    telegramVerifiedAt: row.telegramVerifiedAt?.toISOString() ?? null,
    telegramNotificationsEnabled: row.telegramNotificationsEnabled,
    logsViewEnabled: effectivePermissions.includes(STAFF_LOGS_PERMISSION),
    permissionVersion: row.permissionVersion,
    permissionCodes: effectivePermissions.filter((code) => code !== STAFF_LOGS_PERMISSION),
    createdAt: row.createdAt.toISOString(),
  }
}

function validatePermissions(
  permissionCodes: readonly ShopPermissionCode[],
  enabledFeatures: ReadonlySet<string>,
) {
  for (const code of permissionCodes) {
    const definition = SHOP_PERMISSION_CATALOG.find((item) => item.code === code)
    if (!definition || definition.ownerOnly) return "Xodimga bu ruxsatni berib bo'lmaydi"
    if (definition.featureCode && !enabledFeatures.has(definition.featureCode)) {
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
    const guarded = await requireCurrentShopPermission('MEMBER_MANAGE')
    if (!guarded.ok) return guarded.response
    const { shopId, principal, session } = guarded
    if (!shopId || !principal) return serverError()

    const { id } = await context.params
    const body = await readLimitedJsonBody(request)
    const parsed = updateShopStaffSchema.safeParse({ ...(body as object), staffId: id })
    if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? "Xodim ma'lumoti noto'g'ri")
    if (parsed.data.staffId === principal.actorId) return conflict("Do'kon egasini xodim sifatida o'zgartirib bo'lmaydi")

    if (parsed.data.permissionCodes) {
      const permissionMessage = validatePermissions(parsed.data.permissionCodes, principal.enabledFeatures)
      if (permissionMessage) return badRequest(permissionMessage)
    }
    if (parsed.data.telegramNotificationsEnabled === true && !principal.enabledFeatures.has('TELEGRAM')) {
      return badRequest("Telegram moduli yoqilmagani uchun bildirishnomalarni yoqib bo'lmaydi")
    }
    const passwordHash = parsed.data.password ? await bcrypt.hash(parsed.data.password, 12) : undefined

    const row = await runSerializable(() => prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Shop" WHERE "id" = ${shopId} FOR UPDATE`)
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

      const activePackage = await getActiveShopPackage(shopId, new Date(), tx)
      const activeFeatures = activePackage ? enabledFeatureSet(activePackage) : null
      if (!activeFeatures || !activeFeatures.has('STAFF_ACCESS')) {
        throw Object.assign(new Error('STAFF_ACCESS_DISABLED'), { code: 'STAFF_ACCESS_DISABLED' })
      }
      const permissionSnapshotChanged = parsed.data.permissionCodes !== undefined || parsed.data.logsViewEnabled !== undefined
      const existingPermissionCodes = target.legacyFullAccess
        ? legacyStaffPermissionCodes(activeFeatures)
        : target.permissions.map((item) => item.permissionCode as ShopPermissionCode)
      const nextPermissionCodes = withStaffLogsPermission(
        parsed.data.permissionCodes ?? existingPermissionCodes.filter((code) => code !== STAFF_LOGS_PERMISSION),
        parsed.data.logsViewEnabled ?? existingPermissionCodes.includes(STAFF_LOGS_PERMISSION),
      )
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

      return tx.shopAdmin.findUniqueOrThrow({ where: { id }, select: staffSelect })
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }))

    return ok(staffDto(row, principal.enabledFeatures), "Xodim profili yangilandi")
  } catch (error) {
    if (isRequestBodyTooLarge(error)) return payloadTooLarge()
    if (isInvalidRequestBody(error)) return badRequest("So'rov ma'lumoti noto'g'ri")
    if (error && typeof error === 'object' && 'code' in error) {
      if (error.code === 'STAFF_NOT_FOUND') return notFound('Xodim topilmadi')
      if (error.code === 'OWNER_TARGET') return conflict("Do'kon egasini xodim sifatida o'zgartirib bo'lmaydi")
      if (error.code === 'STAFF_ACCESS_DISABLED') return conflict("Xodimlar profili o'chirilgan")
      if (error.code === 'P2002') return conflict('Bu telefon yoki login allaqachon mavjud')
    }
    logger.error('[PATCH /api/shop/staff/[id]]', { event: 'api.route_error', error })
    return serverError()
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const guarded = await requireCurrentShopPermission('MEMBER_MANAGE')
    if (!guarded.ok) return guarded.response
    const { shopId, principal, session } = guarded
    if (!shopId || !principal) return serverError()
    const { id } = await context.params
    const parsed = deleteShopStaffSchema.safeParse(await readLimitedJsonBody(request))
    if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? "O'chirish sababi noto'g'ri")
    if (id === principal.actorId) return conflict("Do'kon egasini o'chirib bo'lmaydi")

    await runSerializable(() => prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Shop" WHERE "id" = ${shopId} FOR UPDATE`)
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
    }
    logger.error('[DELETE /api/shop/staff/[id]]', { event: 'api.route_error', error })
    return serverError()
  }
}
