/**
 * POST /api/devices/[id]/nasiya — create a nasiya (instalment) plan for a device
 *
 * Validates device is IN_STOCK, creates Customer + Nasiya + NasiyaSchedule rows
 * in a single transaction, updates device status to SOLD_NASIYA, creates
 * notifications, and logs the action.
 */

import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/generated/prisma/client'
import { requireApiSession, resolveActiveShopId } from '@/lib/api-auth'
import { createNasiyaSchema } from '@/lib/validations'
import { generatePaymentSchedule } from '@/lib/nasiya-utils'
import { created, badRequest, notFound, conflict, serverError } from '@/lib/api-helpers'
import { processPendingNotifications } from '@/lib/notification-service'
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
      totalAmount, downPayment, months, monthlyPayment,
      startDate, paymentMethod, appleIdNote, note,
    } = parsed.data

    const resolved = await resolveActiveShopId(session, (body as { shopId?: string }).shopId)
    if (!resolved.ok) return resolved.response
    const { shopId } = resolved
    if (passportPhotoUrl && !passportPhotoUrl.startsWith(`shops/${shopId}/passports/`)) {
      return badRequest("Pasport rasmi boshqa do'konga tegishli")
    }

    const remainingAmount = totalAmount - downPayment
    // Generate exact schedule rows. The last month absorbs rounding remainder.
    const scheduleItems = generatePaymentSchedule(startDate, months, remainingAmount)

    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const device = await tx.device.findFirst({
        where: { id: deviceId, shopId, deletedAt: null },
      })

      if (!device) throw { status: 404, message: "Qurilma topilmadi" }
      if (device.status !== 'IN_STOCK') throw { status: 409, message: "Qurilma nasiyaga sotishga tayyor emas" }

      const reserved = await tx.device.updateMany({
        where: { id: deviceId, shopId, deletedAt: null, status: 'IN_STOCK' },
        data: { status: 'SOLD_NASIYA', updatedAt: new Date() },
      })
      if (reserved.count !== 1) throw { status: 409, message: "Qurilma allaqachon sotilgan" }

      const existingCustomer = await tx.customer.findFirst({
        where: { shopId, phone: customerPhone, deletedAt: null },
      })
      const customer = existingCustomer
        ? await tx.customer.update({
            where: { id: existingCustomer.id },
            data: {
              name: customerName,
              passportPhotoUrl: passportPhotoUrl ?? existingCustomer.passportPhotoUrl,
            },
          })
        : await tx.customer.create({
            data: {
              shopId,
              name: customerName,
              phone: customerPhone,
              passportPhotoUrl,
            },
          })

      const nasiya = await tx.nasiya.create({
        data: {
          shopId,
          deviceId,
          customerId: customer.id,
          totalAmount,
          downPayment,
          remainingAmount,
          months,
          monthlyPayment,
          startDate,
          appleIdNote,
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

      if (downPayment > 0) {
        await tx.nasiyaPayment.create({
          data: {
            nasiyaId: nasiya.id,
            nasiyaScheduleId: null,
            shopId,
            amount: downPayment,
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
      for (const admin of shopAdmins) {
        await tx.notification.create({
          data: {
            shopId,
            type: 'NASIYA',
            message: `✅ Yangi nasiya\n📱 ${device.model}\n👤 ${customerName}\n📞 ${customerPhone}\n💰 ${totalAmount.toLocaleString()} so'm`,
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
          newValue: { customerName, totalAmount, downPayment, months },
        },
      })

      return nasiya
    })

    // Flush freshly-queued notifications immediately (best-effort, post-commit).
    await processPendingNotifications().catch((e) => console.error('[notify] flush failed', e))

    return created(result, "Nasiya muvaffaqiyatli yaratildi")
  } catch (err: unknown) {
    if (typeof err === 'object' && err !== null && 'status' in err) {
      const e = err as { status: number; message: string }
      if (e.status === 404) return notFound(e.message)
      if (e.status === 409) return conflict(e.message)
    }
    console.error('[POST /api/devices/[id]/nasiya]', err)
    return serverError()
  }
}
