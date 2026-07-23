/**
 * POST /api/devices/[id]/nasiya — create a nasiya (instalment) plan for a device
 *
 * Validates device is IN_STOCK, creates Customer + Nasiya + NasiyaSchedule rows
 * in a single transaction, updates device status to SOLD_NASIYA, creates
 * notifications, and logs the action.
 */

import { createHash } from 'node:crypto'
import { NextRequest, after } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/generated/prisma/client'
import { requireShopPermission, resolveActiveShopId } from '@/lib/api-auth'
import { createNasiyaSchema } from '@/lib/validations'
import { created, badRequest, forbidden, notFound, conflict, ok, serverError, tooManyRequests } from '@/lib/api-helpers'
import { flushQueuedTelegramWork } from '@/lib/notification-service'
import { nasiyaCreatedMessage } from '@/lib/telegram-templates'
import { logger } from '@/lib/logger'
import { rateLimitKey } from '@/lib/rate-limit'
import { checkRateLimitDistributed } from '@/lib/rate-limit-adapter'
import { invalidateShopNasiyaMutation } from '@/lib/server/cache-tags'
import { CustomerSelectionError } from '@/lib/server/customer-selection'
import { CustomerPassportConfigurationError } from '@/lib/customer-passport'
import { principalHasPermission } from '@/lib/server/shop-access'
import { moneyInputMeta } from '@/lib/server/money-input'
import { getShopCurrencyContext } from '@/lib/server/currency'
import type { ZodError } from 'zod'
import { presentDeviceSpecs } from '@/lib/device-specs'
import { resolvePrivateUploadReference } from '@/lib/server/private-upload-reference'
import { resolveTelegramRecipients, telegramNotificationRows, telegramUnavailableMarkerRows, TELEGRAM_AUDIENCES } from '@/lib/server/telegram-recipients'
import { createNasiyaContractCore, prepareNasiyaContract } from '@/lib/server/nasiya-contract-core'

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const guarded = await requireShopPermission('NASIYA_CREATE')
    if (!guarded.ok) return guarded.response
    const { session } = guarded

    const { id: deviceId } = await ctx.params
    const idempotencyKey = req.headers.get('idempotency-key')?.trim()
    if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 120) {
      return badRequest("Idempotency-Key sarlavhasi 8–120 belgidan iborat bo'lishi shart")
    }
    const body: unknown = await req.json()
    const parsed = createNasiyaSchema.safeParse(body)

    if (!parsed.success) {
      const firstError = (parsed.error as ZodError).issues[0]?.message ?? "Noto'g'ri ma'lumot"
      return badRequest(firstError)
    }
    if (parsed.data.deviceId !== deviceId) {
      return badRequest("Qurilma ID manzil bilan mos emas")
    }

    const {
      customerMode, customerId, customerName, customerPhone,
      customerAdditionalPhones, customerNote, customerPassportIdentifier, customerTrustOverride,
      passportPhotoUrl,
      totalAmount, downPayment, months, interestPercent,
      monthlyPayment: monthlyPaymentOverrideInput, useMonthlyPaymentOverride,
      startDate, paymentMethod, note,
      earlyReminderEnabled, earlyReminderDays,
    } = parsed.data

    const resolved = await resolveActiveShopId(session, (body as { shopId?: string }).shopId)
    if (!resolved.ok) return resolved.response
    const { shopId } = resolved

    // Hash only the canonical, validated command. Dates are serialized
    // explicitly, Zod defaults are already applied, and unrecognised request
    // fields were stripped. This identity is independent of later FX quotes
    // and private-upload expiry.
    const commandHash = createHash('sha256').update(JSON.stringify({
      version: 2,
      scope: 'standalone-nasiya',
      shopId,
      actorId: session.user.id,
      deviceId,
      command: {
        ...parsed.data,
        startDate: parsed.data.startDate.toISOString(),
      },
    })).digest('hex')
    const replayMatches = (replay: {
      deviceId: string
      createdBy: string
      creationCommandHash: string | null
    }) => (
      replay.deviceId === deviceId
      && replay.createdBy === session.user.id
      && replay.creationCommandHash === commandHash
    )
    // A lost successful response must remain replayable even if the rate
    // provider is down or the submitted private-upload reference has expired.
    const committedReplay = await prisma.nasiya.findUnique({
      where: { shopId_creationIdempotencyKey: { shopId, creationIdempotencyKey: idempotencyKey } },
      select: { id: true, deviceId: true, createdBy: true, creationCommandHash: true },
    })
    if (committedReplay) {
      if (!replayMatches(committedReplay)) {
        return conflict("Idempotency-Key boshqa yoki o'zgartirilgan nasiya uchun ishlatilgan")
      }
      // Repair cache visibility if the original process committed but exited
      // before it could publish its normal invalidation.
      invalidateShopNasiyaMutation(shopId)
      return ok({ id: committedReplay.id }, "Nasiya allaqachon saqlangan")
    }

    const canManagePassport = session.user.role === 'SUPER_ADMIN' ||
      Boolean(guarded.principal && principalHasPermission(guarded.principal, 'CUSTOMER_PASSPORT_MANAGE'))
    const canOverrideTrust = session.user.role === 'SUPER_ADMIN' ||
      Boolean(guarded.principal && principalHasPermission(guarded.principal, 'CUSTOMER_TRUST_OVERRIDE'))
    if (customerMode === 'NEW' && customerPassportIdentifier && !canManagePassport) {
      return forbidden("Pasport ma'lumotlarini qo'shish ruxsati berilmagan")
    }
    if (customerMode === 'NEW' && customerTrustOverride !== undefined && !canOverrideTrust) {
      return forbidden("Ishonch darajasini o'zgartirish ruxsati berilmagan")
    }

    // Distributed when Upstash is configured; bounded in-process fallback otherwise.
    const rate = await checkRateLimitDistributed(rateLimitKey('nasiya-create', shopId, session.user.id), { windowMs: 60_000, max: 20 })
    if (!rate.allowed) return tooManyRequests(rate.retryAfterSeconds)

    const currency = await getShopCurrencyContext(shopId)
    const passportPhotoKey = passportPhotoUrl
      ? resolvePrivateUploadReference({
          value: passportPhotoUrl,
          shopId,
          kind: 'passport',
          allowLegacyRawKey: true,
        }) ?? undefined
      : undefined
    if (passportPhotoUrl && !passportPhotoKey) {
      return badRequest("Pasport rasmi boshqa do'konga tegishli yoki havola muddati tugagan")
    }
    let prepared
    try {
      prepared = await prepareNasiyaContract({
        totalAmount,
        downPayment,
        months,
        interestPercent,
        monthlyPayment: monthlyPaymentOverrideInput,
        useMonthlyPaymentOverride,
        startDate,
        inputCurrency: parsed.data.inputCurrency,
      })
    } catch (err) {
      return badRequest(err instanceof Error ? err.message : "Nasiya summasi noto'g'ri")
    }

    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // The durable command lock is acquired before reserving the device.
      // Concurrent retries with the same key therefore re-check the committed
      // Nasiya row instead of losing to the device status transition.
      await tx.$executeRaw(Prisma.sql`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`nasiya-create:${shopId}:${idempotencyKey}`}, 0)
        )
      `)
      const replay = await tx.nasiya.findUnique({
        where: { shopId_creationIdempotencyKey: { shopId, creationIdempotencyKey: idempotencyKey } },
        select: { id: true, deviceId: true, createdBy: true, creationCommandHash: true },
      })
      if (replay) {
        if (!replayMatches(replay)) {
          throw { status: 409, message: "Idempotency-Key boshqa yoki o'zgartirilgan nasiya uchun ishlatilgan" }
        }
        return { id: replay.id, duplicate: true as const }
      }

      const device = await tx.device.findFirst({
        where: { id: deviceId, shopId, deletedAt: null },
        include: { shop: { select: { name: true } }, imeis: { where: { deletedAt: null } } },
      })

      if (!device) throw { status: 404, message: "Qurilma topilmadi" }
      if (device.status !== 'IN_STOCK') throw { status: 409, message: "Qurilma nasiyaga sotishga tayyor emas" }

      const { nasiya, customer } = await createNasiyaContractCore({
        tx,
        shopId,
        device,
        reserveInStockDevice: true,
        prepared,
        customer: {
          mode: customerMode,
          customerId,
          customerName,
          customerPhone,
          customerAdditionalPhones,
          customerNote,
          customerPassportIdentifier,
          customerTrustOverride,
          passportPhotoUrl: passportPhotoKey,
        },
        months,
        startDate,
        paymentMethod,
        earlyReminderEnabled,
        earlyReminderDays,
        note,
        actorId: session.user.id,
        creationIdempotencyKey: idempotencyKey,
        creationCommandHash: commandHash,
      })

      const recipients = await resolveTelegramRecipients(tx, {
        shopId,
        audience: TELEGRAM_AUDIENCES.OWNER_AND_ACTIVE_STAFF,
      })
      const nasiyaMessage = nasiyaCreatedMessage({
        shopName: device.shop.name,
        customerName: customer.name,
        customerPhone: customer.phone,
        device: presentDeviceSpecs(device),
        totalAmount: prepared.amounts.totalAmount,
        downPayment: prepared.amounts.downPayment,
        baseRemainingAmount: prepared.amounts.baseRemainingAmount,
        interestPercent: prepared.amounts.interestPercent,
        interestAmount: prepared.amounts.interestAmount,
        finalNasiyaAmount: prepared.amounts.finalNasiyaAmount,
        months,
        monthlyPayment: prepared.amounts.monthlyPayment,
        nextPaymentDate: prepared.scheduleItems[0]?.dueDate ?? null,
        adminName: session.user.name,
        currency,
      })
      const scheduledAt = new Date()
      const notificationRows = [
        ...telegramNotificationRows(recipients, {
          type: 'NASIYA',
          message: nasiyaMessage,
          scheduledAt,
          relatedId: nasiya.id,
          relatedType: 'Nasiya',
        }),
        ...telegramUnavailableMarkerRows(recipients, {
          type: 'NASIYA',
          dedupeScope: nasiya.id,
          cancelledAt: scheduledAt,
        }),
      ]
      if (notificationRows.length > 0) await tx.notification.createMany({ data: notificationRows })

      await tx.log.create({
        data: {
          shopId,
          actorId: session.user.id,
          actorType: session.user.role as 'SUPER_ADMIN' | 'SHOP_ADMIN',
          action: 'CREATE_NASIYA',
          targetType: 'Nasiya',
          targetId: nasiya.id,
          newValue: {
            customerId: customer.id,
            customerName: customer.name,
            totalAmount: prepared.amounts.totalAmount,
            inputTotalAmount: totalAmount,
            downPayment: prepared.amounts.downPayment,
            inputDownPayment: downPayment,
            baseRemainingAmount: prepared.amounts.baseRemainingAmount,
            interestPercent: prepared.amounts.interestPercent,
            interestAmount: prepared.amounts.interestAmount,
            finalNasiyaAmount: prepared.amounts.finalNasiyaAmount,
            months,
            ...moneyInputMeta(prepared.totalInput),
          },
        },
      })

      // This mutation's caller only needs the identifier to navigate to the
      // detail endpoint. Keeping its response identifier-only guarantees no
      // Prisma Decimal values bypass the MoneyDto boundary into React.
      return { id: nasiya.id, duplicate: false as const }
    })

    invalidateShopNasiyaMutation(shopId)

    // Flush freshly-queued notifications after the response (non-blocking).
    // The rows are already committed, so cron is the backstop if this misses.
    if (!result.duplicate) {
      after(() => flushQueuedTelegramWork().catch((e) => logger.warn('notification flush failed', { event: 'notification.flush_failed', error: e })))
    }

    const response = { id: result.id }
    return result.duplicate
      ? ok(response, "Nasiya allaqachon saqlangan")
      : created(response, "Nasiya muvaffaqiyatli yaratildi")
  } catch (err: unknown) {
    if (err instanceof CustomerPassportConfigurationError) {
      return serverError("Pasport ma'lumotlarini saqlash sozlanmagan. CUSTOMER_PII_ENCRYPTION_KEY va CUSTOMER_PII_SEARCH_KEY ni sozlang.")
    }
    if (err instanceof CustomerSelectionError) {
      if (err.status === 404) return notFound(err.message)
      if (err.status === 409) return conflict(err.message)
      return badRequest(err.message)
    }
    if (typeof err === 'object' && err !== null && 'status' in err) {
      const e = err as { status: number; message: string }
      if (e.status === 404) return notFound(e.message)
      if (e.status === 409) return conflict(e.message)
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return conflict('Bu telefon yoki pasport bilan faol mijoz mavjud. Uni qidiruvdan tanlang; mijozlar avtomatik birlashtirilmaydi.')
    }
    logger.error('[POST /api/devices/[id]/nasiya]', { event: 'api.route_error', error: err })
    return serverError()
  }
}
