/**
 * POST /api/nasiya/import — manually import an EXISTING (pre-Oryx) nasiya.
 *
 * This records carried-over debt, NOT a new sale:
 *   - creates a Device as SOLD_NASIYA (never IN_STOCK, purchasePrice 0, isImported)
 *   - creates a Nasiya with isImported=true; originalTotalAmount /
 *     alreadyPaidBeforeImport are informational and excluded from current gross/
 *     income/profit (shop-stats filters isImported=false)
 *   - generates ONLY the future schedule from the remaining debt
 *   - creates NO Sale row and NO NasiyaPayment for already-paid money
 *
 * Auth: SHOP_ADMIN only, scoped to their own shop.
 */

import { NextRequest, after } from 'next/server'
import { randomBytes } from 'crypto'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/generated/prisma/client'
import { requireApiSession } from '@/lib/api-auth'
import { importNasiyaSchema } from '@/lib/validations'
import { generateImportSchedule } from '@/lib/nasiya-utils'
import { created, badRequest, conflict, forbidden, serverError } from '@/lib/api-helpers'
import { processPendingNotifications } from '@/lib/notification-service'
import { nasiyaImportedMessage } from '@/lib/telegram-templates'
import { logger } from '@/lib/logger'
import { invalidateShopNasiyaMutation } from '@/lib/server/cache-tags'
import { normalizePhone } from '@/lib/phone'
import type { ZodError } from 'zod'

export async function POST(req: NextRequest) {
  try {
    const guarded = await requireApiSession()
    if (!guarded.ok) return guarded.response
    const { session } = guarded

    if (session.user.role !== 'SHOP_ADMIN' || !session.user.shopId) {
      return forbidden("Faqat do'kon adminlari eski nasiya import qila oladi")
    }
    const shopId = session.user.shopId

    const body: unknown = await req.json()
    const parsed = importNasiyaSchema.safeParse(body)
    if (!parsed.success) {
      const firstError = (parsed.error as ZodError).issues[0]?.message ?? "Noto'g'ri ma'lumot"
      return badRequest(firstError)
    }
    const data = parsed.data

    const enteredImei = data.imei?.trim() || ''
    const normalizedPhone = normalizePhone(data.customerPhone)

    // Build the future-only schedule up-front so we can reject bad money before
    // touching the DB, and reuse the exact rows inside the transaction.
    let schedule: ReturnType<typeof generateImportSchedule>
    try {
      schedule = generateImportSchedule(data.nextPaymentDate, data.remainingDebt, data.monthlyPayment)
    } catch (error) {
      return badRequest(error instanceof Error ? error.message : "To'lov jadvali noto'g'ri")
    }
    const scheduleTotal = schedule.reduce((sum, item) => sum + item.expectedAmount, 0)
    if (scheduleTotal !== Math.round(data.remainingDebt)) {
      return badRequest("To'lov jadvali qolgan qarz bilan mos emas")
    }

    // Reject a duplicate active IMEI up-front (also guarded by the DB partial
    // unique index). A blank IMEI gets a unique IMPORT- placeholder so multiple
    // no-IMEI imports don't collide on the active-IMEI unique index.
    if (enteredImei) {
      const dup = await prisma.device.findFirst({
        where: { shopId, imei: enteredImei, deletedAt: null },
        select: { id: true },
      })
      if (dup) return conflict('Bu IMEI raqami allaqachon mavjud')
    }

    const duplicateImport = await prisma.nasiya.findFirst({
      where: {
        shopId,
        deletedAt: null,
        isImported: true,
        status: { not: 'CANCELLED' },
        remainingAtImport: Math.round(data.remainingDebt),
        monthlyPayment: Math.round(data.monthlyPayment),
        ...(data.originalSaleDate ? { originalSaleDate: data.originalSaleDate } : {}),
        customer: {
          is: {
            shopId,
            deletedAt: null,
            OR: [...(normalizedPhone ? [{ normalizedPhone }] : []), { phone: data.customerPhone }],
          },
        },
        device: {
          is: {
            shopId,
            deletedAt: null,
            model: data.deviceModel,
          },
        },
      },
      select: { id: true },
    })
    if (duplicateImport) {
      return conflict("Bu mijoz va qurilma uchun shunga o'xshash eski nasiya allaqachon import qilingan")
    }

    const storedImei = enteredImei || `IMPORT-${randomBytes(4).toString('hex').toUpperCase()}`

    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const existingCustomer = await tx.customer.findFirst({
        where: {
          shopId,
          deletedAt: null,
          OR: [...(normalizedPhone ? [{ normalizedPhone }] : []), { phone: data.customerPhone }],
        },
      })
      const customer = existingCustomer
        ? await tx.customer.update({
            where: { id: existingCustomer.id },
            data: { name: data.customerName, normalizedPhone },
          })
        : await tx.customer.create({
            data: { shopId, name: data.customerName, phone: data.customerPhone, normalizedPhone },
          })

      // Device exists only to carry the debt — SOLD_NASIYA, cost 0, imported.
      const device = await tx.device.create({
        data: {
          shopId,
          model: data.deviceModel,
          color: data.color || null,
          storage: data.storage || null,
          batteryHealth: data.batteryHealth ?? null,
          purchasePrice: 0,
          imei: storedImei,
          status: 'SOLD_NASIYA',
          isImported: true,
          addedBy: session.user.id,
        },
      })

      const remainingDebt = Math.round(data.remainingDebt)
      const nasiya = await tx.nasiya.create({
        data: {
          shopId,
          deviceId: device.id,
          customerId: customer.id,
          // Legacy accounting fields, mapped for display; excluded from current
          // gross/profit because isImported=true.
          totalAmount: data.originalTotalAmount,
          downPayment: data.alreadyPaidBeforeImport,
          baseRemainingAmount: remainingDebt,
          interestPercent: 0,
          interestAmount: 0,
          finalNasiyaAmount: remainingDebt,
          remainingAmount: remainingDebt,
          months: schedule.length,
          monthlyPayment: Math.round(data.monthlyPayment),
          startDate: data.nextPaymentDate,
          note: data.importNote,
          createdBy: session.user.id,
          // Import bookkeeping
          isImported: true,
          importSource: 'MANUAL',
          importedAt: new Date(),
          importedById: session.user.id,
          originalSaleDate: data.originalSaleDate ?? null,
          originalTotalAmount: data.originalTotalAmount,
          alreadyPaidBeforeImport: data.alreadyPaidBeforeImport,
          remainingAtImport: remainingDebt,
          importNote: data.importNote,
        },
      })

      await tx.nasiyaSchedule.createMany({
        data: schedule.map((item) => ({
          nasiyaId: nasiya.id,
          shopId,
          monthNumber: item.monthNumber,
          dueDate: item.dueDate,
          expectedAmount: item.expectedAmount,
        })),
      })

      // NOTE: intentionally NO NasiyaPayment row for alreadyPaidBeforeImport —
      // that money was collected before Oryx and must never count as current cash.

      await tx.log.create({
        data: {
          shopId,
          actorId: session.user.id,
          actorType: 'SHOP_ADMIN',
          action: 'IMPORT_NASIYA',
          targetType: 'Nasiya',
          targetId: nasiya.id,
          newValue: {
            customerName: data.customerName,
            model: data.deviceModel,
            imei: enteredImei || null,
            originalTotalAmount: data.originalTotalAmount,
            alreadyPaidBeforeImport: data.alreadyPaidBeforeImport,
            remainingAtImport: remainingDebt,
            importSource: 'MANUAL',
          },
          note: data.importNote,
        },
      })

      const shopAdmins = await tx.shopAdmin.findMany({
        where: { shopId, deletedAt: null, isActive: true, telegramId: { not: '' }, telegramVerifiedAt: { not: null } },
      })
      const shop = await tx.shop.findUnique({ where: { id: shopId }, select: { name: true } })
      const message = nasiyaImportedMessage({
        shopName: shop?.name ?? '',
        customerName: data.customerName,
        customerPhone: data.customerPhone,
        device: {
          deviceModel: data.deviceModel,
          storage: data.storage,
          color: data.color,
          imei: enteredImei || null,
        },
        originalTotalAmount: data.originalTotalAmount,
        alreadyPaidBeforeImport: data.alreadyPaidBeforeImport,
        remainingDebt,
        monthlyPayment: Math.round(data.monthlyPayment),
        nextPaymentDate: data.nextPaymentDate,
        adminName: session.user.name,
      })
      for (const admin of shopAdmins) {
        await tx.notification.create({
          data: {
            shopId,
            type: 'NASIYA_IMPORTED',
            message,
            telegramId: admin.telegramId!,
            scheduledAt: new Date(),
            relatedId: nasiya.id,
            relatedType: 'Nasiya',
          },
        })
      }

      return { nasiyaId: nasiya.id, deviceId: device.id, scheduleCount: schedule.length }
    })

    invalidateShopNasiyaMutation(shopId)

    after(() =>
      processPendingNotifications().catch((e) =>
        logger.warn('notification flush failed', { event: 'notification.flush_failed', route: '/api/nasiya/import', error: e }),
      ),
    )

    return created(result, 'Eski nasiya muvaffaqiyatli import qilindi')
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return conflict('Bu IMEI raqami allaqachon mavjud')
    }
    console.error('[POST /api/nasiya/import]', err)
    return serverError()
  }
}
