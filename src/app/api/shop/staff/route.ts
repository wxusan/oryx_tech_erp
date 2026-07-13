import { NextRequest } from 'next/server'
import bcrypt from 'bcrypt'
import { Prisma } from '@/generated/prisma/client'
import { requireCurrentShopPermission } from '@/lib/api-auth'
import { badRequest, conflict, created, ok, payloadTooLarge, serverError } from '@/lib/api-helpers'
import {
  SHOP_PERMISSION_CATALOG,
  type ShopPermissionCode,
} from '@/lib/access-control'
import { prisma } from '@/lib/prisma'
import { enabledFeatureSet, getActiveShopPackage } from '@/lib/server/shop-access'
import {
  createShopStaffSchema,
  type ShopStaffDto,
} from '@/lib/shop-staff-contract'
import { isTelegramIdTaken, normalizeTelegramId } from '@/lib/telegram-id'
import {
  isInvalidRequestBody,
  isRequestBodyTooLarge,
  readLimitedJsonBody,
} from '@/lib/server/request-limits'
import { isRetryableTransactionError } from '@/lib/server/transaction-retry'
import { logger } from '@/lib/logger'

const staffSelect = {
  id: true,
  name: true,
  phone: true,
  login: true,
  isActive: true,
  telegramId: true,
  telegramVerifiedAt: true,
  telegramNotificationsEnabled: true,
  permissionVersion: true,
  createdAt: true,
  permissions: { select: { permissionCode: true } },
} satisfies Prisma.ShopAdminSelect

type StaffRow = Prisma.ShopAdminGetPayload<{ select: typeof staffSelect }>

function staffDto(row: StaffRow): ShopStaffDto {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    login: row.login,
    isActive: row.isActive,
    telegramId: row.telegramId,
    telegramVerifiedAt: row.telegramVerifiedAt?.toISOString() ?? null,
    telegramNotificationsEnabled: row.telegramNotificationsEnabled,
    permissionVersion: row.permissionVersion,
    createdAt: row.createdAt.toISOString(),
    permissionCodes: row.permissions.map((item) => item.permissionCode as ShopPermissionCode),
  }
}

function permissionError(
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

export async function GET() {
  try {
    const guarded = await requireCurrentShopPermission('MEMBER_MANAGE')
    if (!guarded.ok) return guarded.response
    const { shopId, principal } = guarded
    if (!shopId || !principal) return serverError()

    const staff = await prisma.shopAdmin.findMany({
      where: {
        shopId,
        id: { not: principal.actorId },
        deletedAt: null,
      },
      orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }],
      select: staffSelect,
    })
    return ok(staff.map(staffDto))
  } catch (error) {
    logger.error('[GET /api/shop/staff]', { event: 'api.route_error', error })
    return serverError()
  }
}

export async function POST(request: NextRequest) {
  try {
    const guarded = await requireCurrentShopPermission('MEMBER_MANAGE')
    if (!guarded.ok) return guarded.response
    const { shopId, principal, session } = guarded
    if (!shopId || !principal) return serverError()

    const parsed = createShopStaffSchema.safeParse(await readLimitedJsonBody(request))
    if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? "Xodim ma'lumoti noto'g'ri")

    const permissionMessage = permissionError(parsed.data.permissionCodes, principal.enabledFeatures)
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
      const activePackage = await getActiveShopPackage(shopId, new Date(), tx)
      if (!activePackage || !enabledFeatureSet(activePackage).has('STAFF_ACCESS')) {
        throw Object.assign(new Error('STAFF_ACCESS_DISABLED'), { code: 'STAFF_ACCESS_DISABLED' })
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
          passwordHash,
          legacyFullAccess: false,
        },
        select: { id: true },
      })
      if (parsed.data.permissionCodes.length) {
        await tx.shopMemberPermission.createMany({
          data: parsed.data.permissionCodes.map((permissionCode) => ({
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
            permissionCodes: parsed.data.permissionCodes,
            telegramNotificationsEnabled: parsed.data.telegramNotificationsEnabled,
          },
        },
      })
      return tx.shopAdmin.findUniqueOrThrow({ where: { id: createdStaff.id }, select: staffSelect })
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }))

    return created(staffDto(row), "Xodim profili qo'shildi")
  } catch (error) {
    if (isRequestBodyTooLarge(error)) return payloadTooLarge()
    if (isInvalidRequestBody(error)) return badRequest("So'rov ma'lumoti noto'g'ri")
    if (error && typeof error === 'object' && 'code' in error) {
      if (error.code === 'STAFF_ACCESS_DISABLED') return conflict("Xodimlar profili o'chirilgan")
      if (error.code === 'TELEGRAM_TAKEN') return conflict('Bu Telegram ID allaqachon mavjud')
      if (error.code === 'P2002') return conflict('Login yoki Telegram ID allaqachon mavjud')
    }
    logger.error('[POST /api/shop/staff]', { event: 'api.route_error', error })
    return serverError()
  }
}
