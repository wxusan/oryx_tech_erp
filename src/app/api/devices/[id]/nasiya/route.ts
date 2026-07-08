/**
 * POST /api/devices/[id]/nasiya — create a nasiya (instalment) plan for a device
 *
 * Validates device is IN_STOCK, creates Customer + Nasiya + NasiyaSchedule rows
 * in a single transaction, updates device status to SOLD_NASIYA, creates
 * notifications, and logs the action.
 */

import { NextRequest, after } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/generated/prisma/client'
import { requireApiSession, resolveActiveShopId } from '@/lib/api-auth'
import { createNasiyaSchema } from '@/lib/validations'
import { calculateNasiyaAmounts, generatePaymentSchedule } from '@/lib/nasiya-utils'
import { created, badRequest, notFound, conflict, serverError } from '@/lib/api-helpers'
import { processPendingNotifications } from '@/lib/notification-service'
import { nasiyaCreatedMessage } from '@/lib/telegram-templates'
import { logger } from '@/lib/logger'
import { invalidateShopNasiyaMutation } from '@/lib/server/cache-tags'
import { normalizePhone } from '@/lib/phone'
import { moneyInputToUzs, moneyInputMeta } from '@/lib/server/money-input'
import { getShopCurrencyContext } from '@/lib/server/currency'
import type { ZodError } from 'zod'

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const guarded = await requireApiSession()
    if (!guarded.ok) return guarded.response
    const { session } = guarded

    const { id: deviceId } = await ctx.params
    const body: unknown = await req.json()
    const parsed = createNasiyaSchema.safeParse(body)

    if (!parsed.success) {
      const firstError = (parsed.error as ZodError).issues[0]?.message ?? "Noto'g'ri ma'lumot"
      return badRequest(firstError)
    }

    const {
      customerName, customerPhone, passportPhotoUrl,
      totalAmount, downPayment, months, interestPercent,
      startDate, paymentMethod, note,
      earlyReminderEnabled, earlyReminderDays,
    } = parsed.data

    const resolved = await resolveActiveShopId(session, (body as { shopId?: string }).shopId)
    if (!resolved.ok) return resolved.response
    const { shopId } = resolved
    const currency = await getShopCurrencyContext(shopId)
    if (passportPhotoUrl && !passportPhotoUrl.startsWith(`shops/${shopId}/passports/`)) {
      return badRequest("Pasport rasmi boshqa do'konga tegishli")
    }
    const normalizedPhone = normalizePhone(customerPhone)
    let totalInput: Awaited<ReturnType<typeof moneyInputToUzs>>
    let downPaymentInput: Awaited<ReturnType<typeof moneyInputToUzs>>
    try {
      totalInput = await moneyInputToUzs(totalAmount, parsed.data.inputCurrency)
      downPaymentInput = await moneyInputToUzs(downPayment, parsed.data.inputCurrency)
    } catch (err) {
      return badRequest(err instanceof Error ? err.message : 'Valyuta kursi mavjud emas')
    }

    let amounts: ReturnType<typeof calculateNasiyaAmounts>
    try {
      amounts = calculateNasiyaAmounts({
        totalAmount: totalInput.amountUzs,
        downPayment: downPaymentInput.amountUzs,
        months,
        interestPercent,
      })
    } catch (error) {
      return badRequest(error instanceof Error ? error.message : "Nasiya summasi noto'g'ri")
    }

    // Generate exact schedule rows. The last month absorbs rounding remainder.
    const scheduleItems = generatePaymentSchedule(startDate, months, amounts.finalNasiyaAmount)
    const scheduleTotal = scheduleItems.reduce((sum, item) => sum + item.expectedAmount, 0)
    if (scheduleTotal !== amounts.finalNasiyaAmount) {
      return badRequest("To'lov jadvali nasiya jami bilan mos emas")
    }

    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const device = await tx.device.findFirst({
        where: { id: deviceId, shopId, deletedAt: null },
        include: { shop: { select: { name: true } } },
      })

      if (!device) throw { status: 404, message: "Qurilma topilmadi" }
      if (device.status !== 'IN_STOCK') throw { status: 409, message: "Qurilma nasiyaga sotishga tayyor emas" }

      const reserved = await tx.device.updateMany({
        where: { id: deviceId, shopId, deletedAt: null, status: 'IN_STOCK' },
        data: { status: 'SOLD_NASIYA', updatedAt: new Date() },
      })
      if (reserved.count !== 1) throw { status: 409, message: "Qurilma allaqachon sotilgan" }

      const existingCustomer = await tx.customer.findFirst({
        where: {
          shopId,
          deletedAt: null,
          OR: [
            ...(normalizedPhone ? [{ normalizedPhone }] : []),
            { phone: customerPhone },
          ],
        },
      })
      const customer = existingCustomer
        ? await tx.customer.update({
            where: { id: existingCustomer.id },
            data: {
              name: customerName,
              normalizedPhone,
              passportPhotoUrl: passportPhotoUrl ?? existingCustomer.passportPhotoUrl,
            },
          })
        : await tx.customer.create({
            data: {
              shopId,
              name: customerName,
              phone: customerPhone,
              normalizedPhone,
              passportPhotoUrl,
            },
          })

      const nasiya = await tx.nasiya.create({
        data: {
          shopId,
          deviceId,
          customerId: customer.id,
          totalAmount: amounts.totalAmount,
          downPayment: amounts.downPayment,
          baseRemainingAmount: amounts.baseRemainingAmount,
          interestPercent: amounts.interestPercent,
          interestAmount: amounts.interestAmount,
          finalNasiyaAmount: amounts.finalNasiyaAmount,
          remainingAmount: amounts.finalNasiyaAmount,
          months,
          monthlyPayment: amounts.monthlyPayment,
          startDate,
          earlyReminderEnabled,
          earlyReminderDays: earlyReminderEnabled ? earlyReminderDays : null,
          note,
          createdBy: session.user.id,
        },
      })

      // Create one NasiyaSchedule row per month
      await tx.nasiyaSchedule.createMany({
        data: scheduleItems.map((item) => ({
          nasiyaId: nasiya.id,
          shopId,
          monthNumber: item.monthNumber,
          dueDate: item.dueDate,
          expectedAmount: item.expectedAmount,
        })),
      })

      if (amounts.downPayment > 0) {
        await tx.nasiyaPayment.create({
          data: {
            nasiyaId: nasiya.id,
            nasiyaScheduleId: null,
            shopId,
            amount: amounts.downPayment,
            paymentMethod,
            paidAt: new Date(),
            note: "Boshlang'ich to'lov",
            createdBy: session.user.id,
          },
        })
      }

      const shopAdmins = await tx.shopAdmin.findMany({
        where: { shopId, deletedAt: null, isActive: true, telegramId: { not: '' }, telegramVerifiedAt: { not: null } },
      })
      const nasiyaMessage = nasiyaCreatedMessage({
        shopName: device.shop.name,
        customerName,
        customerPhone,
        device: {
          deviceModel: device.model,
          storage: device.storage,
          color: device.color,
          batteryHealth: device.batteryHealth,
          imei: device.imei,
        },
        totalAmount: amounts.totalAmount,
        downPayment: amounts.downPayment,
        baseRemainingAmount: amounts.baseRemainingAmount,
        interestPercent: amounts.interestPercent,
        interestAmount: amounts.interestAmount,
        finalNasiyaAmount: amounts.finalNasiyaAmount,
        months,
        monthlyPayment: amounts.monthlyPayment,
        nextPaymentDate: scheduleItems[0]?.dueDate ?? null,
        adminName: session.user.name,
        currency,
      })
      for (const admin of shopAdmins) {
        await tx.notification.create({
          data: {
            shopId,
            type: 'NASIYA',
            message: nasiyaMessage,
            telegramId: admin.telegramId!,
            scheduledAt: new Date(),
            relatedId: nasiya.id,
            relatedType: 'Nasiya',
          },
        })
      }

      await tx.log.create({
        data: {
          shopId,
          actorId: session.user.id,
          actorType: session.user.role as 'SUPER_ADMIN' | 'SHOP_ADMIN',
          action: 'CREATE_NASIYA',
          targetType: 'Nasiya',
          targetId: nasiya.id,
          newValue: {
            customerName,
            totalAmount: amounts.totalAmount,
            inputTotalAmount: totalAmount,
            downPayment: amounts.downPayment,
            inputDownPayment: downPayment,
            baseRemainingAmount: amounts.baseRemainingAmount,
            interestPercent: amounts.interestPercent,
            interestAmount: amounts.interestAmount,
            finalNasiyaAmount: amounts.finalNasiyaAmount,
            months,
            ...moneyInputMeta(totalInput),
          },
        },
      })

      return nasiya
    })

    invalidateShopNasiyaMutation(shopId)

    // Flush freshly-queued notifications after the response (non-blocking).
    // The rows are already committed, so cron is the backstop if this misses.
    after(() => processPendingNotifications().catch((e) => logger.warn('notification flush failed', { event: 'notification.flush_failed', error: e })))

    return created(result, "Nasiya muvaffaqiyatli yaratildi")
  } catch (err: unknown) {
    if (typeof err === 'object' && err !== null && 'status' in err) {
      const e = err as { status: number; message: string }
      if (e.status === 404) return notFound(e.message)
      if (e.status === 409) return conflict(e.message)
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return conflict('Bu telefon raqam bilan faol mijoz allaqachon mavjud')
    }
    console.error('[POST /api/devices/[id]/nasiya]', err)
    return serverError()
  }
}
