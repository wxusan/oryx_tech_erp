/**
 * GET /api/cron/reminders
 *
 * Daily cron job that:
 *   1. Sends a reminder to shop admins for every NasiyaSchedule due today.
 *   2. Sends an overdue alert for every NasiyaSchedule past its due date
 *      that is still PENDING or PARTIAL, and marks them OVERDUE.
 *
 * Vercel cron configuration (vercel.json):
 * {
 *   "crons": [{ "path": "/api/cron/reminders", "schedule": "0 3 * * *" }]
 * }
 * This runs at 08:00 Asia/Tashkent.
 *
 * Vercel Cron sends Authorization: Bearer <CRON_SECRET> automatically when the
 * env var is configured. The same header can be used by external schedulers:
 *   Authorization: Bearer <CRON_SECRET>
 *
 * Response:
 *   { reminders: number, overdue: number }
 */

import { type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { hasValidInternalSecret, internalSecret } from '@/lib/api-auth'
import { processPendingNotifications } from '@/lib/notification-service'
import { invalidateShopOverdueCron } from '@/lib/server/cache-tags'
import { tashkentDayRange } from '@/lib/timezone'
import { recordOpsEvent } from '@/lib/server/ops-events'

export const maxDuration = 60

function outstandingAmount(expected: unknown, paid: unknown) {
  return Math.max(0, Number(expected) - Number(paid ?? 0))
}

// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest): Promise<Response> {
  if (!internalSecret()) {
    return new Response('Internal secret is not configured', { status: 503 })
  }

  if (!hasValidInternalSecret(request)) {
    return new Response('Unauthorized', { status: 401 })
  }

  const startedAt = Date.now()
  await recordOpsEvent({ level: 'INFO', event: 'cron.reminders.started', message: 'Reminders cron started' })

  try {
  const { start: today, end: tomorrow, dayKey } = tashkentDayRange()

  // -------------------------------------------------------------------------
  // 1. Today's reminders — dueDate = today, status PENDING or PARTIAL
  // -------------------------------------------------------------------------

  const dueToday = await prisma.nasiyaSchedule.findMany({
    where: {
      OR: [
        { delayedUntil: null, dueDate: { gte: today, lt: tomorrow } },
        { delayedUntil: { gte: today, lt: tomorrow } },
      ],
      status: { in: ['PENDING', 'PARTIAL', 'DEFERRED'] },
      nasiya: {
        deletedAt: null,
        reminderEnabled: true,
        shop: { status: 'ACTIVE', deletedAt: null },
      },
    },
    include: {
      nasiya: {
        include: {
          customer: true,
          device: true,
          shop: {
            include: {
              admins: { where: { deletedAt: null, isActive: true, telegramId: { not: '' }, telegramVerifiedAt: { not: null } } },
            },
          },
        },
      },
    },
  })

  for (const schedule of dueToday) {
    const { nasiya } = schedule
    const msg = `⏰ Bugungi to'lov eslatmasi\n👤 ${nasiya.customer.name}\n📞 ${nasiya.customer.phone}\n📱 ${nasiya.device.model}\n💵 ${outstandingAmount(schedule.expectedAmount, schedule.paidAmount).toLocaleString()} so'm`
    for (const admin of nasiya.shop.admins) {
      const dedupeKey = `REMINDER:${dayKey}:${admin.telegramId}:${schedule.id}`
      await prisma.notification.upsert({
        where: { dedupeKey },
        update: {},
        create: {
          dedupeKey,
          shopId: nasiya.shopId,
          type: 'REMINDER',
          message: msg,
          telegramId: admin.telegramId!,
          scheduledAt: new Date(),
          relatedId: schedule.id,
          relatedType: 'NasiyaSchedule',
        },
      })
    }
  }

  // -------------------------------------------------------------------------
  // 2. Overdue — dueDate < today and still unpaid.
  //    OVERDUE is included in the selection so chronically-overdue schedules
  //    keep alerting every day (deduped per day by dayKey), not just once.
  //    PAID/COMPLETED schedules fall out because their status is no longer in
  //    this set. Cancelled/returned/reminder-off nasiyas are excluded via the
  //    nasiya filter below.
  // -------------------------------------------------------------------------

  const overdue = await prisma.nasiyaSchedule.findMany({
    where: {
      OR: [
        { delayedUntil: null, dueDate: { lt: today } },
        { delayedUntil: { lt: today } },
      ],
      status: { in: ['PENDING', 'PARTIAL', 'DEFERRED', 'OVERDUE'] },
      nasiya: {
        deletedAt: null,
        reminderEnabled: true,
        shop: { status: 'ACTIVE', deletedAt: null },
      },
    },
    include: {
      nasiya: {
        include: {
          customer: true,
          device: true,
          shop: {
            include: {
              admins: { where: { deletedAt: null, isActive: true, telegramId: { not: '' }, telegramVerifiedAt: { not: null } } },
            },
          },
        },
      },
    },
  })

  for (const schedule of overdue) {
    const effectiveDue = schedule.delayedUntil ?? schedule.dueDate
    const daysLate = Math.floor((today.getTime() - effectiveDue.getTime()) / 86400000)
    const msg = `🔴 Muddati o'tgan to'lov\n👤 ${schedule.nasiya.customer.name}\n📞 ${schedule.nasiya.customer.phone}\n📱 ${schedule.nasiya.device.model}\n💵 ${outstandingAmount(schedule.expectedAmount, schedule.paidAmount).toLocaleString()} so'm\n⏳ ${daysLate} kun kechikmoqda`
    await prisma.$transaction(async (tx) => {
      for (const admin of schedule.nasiya.shop.admins) {
        const dedupeKey = `OVERDUE:${dayKey}:${admin.telegramId}:${schedule.id}`
        await tx.notification.upsert({
          where: { dedupeKey },
          update: {},
          create: {
            dedupeKey,
            shopId: schedule.nasiya.shopId,
            type: 'OVERDUE',
            message: msg,
            telegramId: admin.telegramId!,
            scheduledAt: new Date(),
            relatedId: schedule.id,
            relatedType: 'NasiyaSchedule',
          },
        })
      }

      await tx.nasiyaSchedule.updateMany({
        where: { id: schedule.id, status: { in: ['PENDING', 'PARTIAL', 'DEFERRED'] } },
        data: { status: 'OVERDUE' },
      })
      await tx.nasiya.update({
        where: { id: schedule.nasiya.id },
        data: { status: 'OVERDUE' },
      })
    })
  }

  // Bust caches for shops whose nasiya schedules / parent status were just
  // marked OVERDUE so the list, dashboard and reports refresh immediately
  // instead of serving a stale "Faol" snapshot until the tag TTL expires.
  const overdueShopIds = new Set(overdue.map((schedule) => schedule.nasiya.shopId))
  for (const overdueShopId of overdueShopIds) {
    invalidateShopOverdueCron(overdueShopId)
  }

  const salePaymentsDueToday = await prisma.sale.findMany({
    where: {
      deletedAt: null,
      paidFully: false,
      remainingAmount: { gt: 0 },
      reminderEnabled: true,
      dueDate: { gte: today, lt: tomorrow },
      shop: { status: 'ACTIVE', deletedAt: null },
    },
    include: {
      customer: true,
      device: true,
      shop: {
        include: {
          admins: { where: { deletedAt: null, isActive: true, telegramId: { not: '' }, telegramVerifiedAt: { not: null } } },
        },
      },
    },
  })

  for (const sale of salePaymentsDueToday) {
    const msg = `⏰ Bugungi qarz to'lovi\n👤 ${sale.customer.name}\n📞 ${sale.customer.phone}\n📱 ${sale.device.model}\n💵 ${Number(sale.remainingAmount).toLocaleString()} so'm`
    for (const admin of sale.shop.admins) {
      const dedupeKey = `SALE_REMINDER:${dayKey}:${admin.telegramId}:${sale.id}`
      await prisma.notification.upsert({
        where: { dedupeKey },
        update: {},
        create: {
          dedupeKey,
          shopId: sale.shopId,
          type: 'SALE_REMINDER',
          message: msg,
          telegramId: admin.telegramId!,
          scheduledAt: new Date(),
          relatedId: sale.id,
          relatedType: 'Sale',
        },
      })
    }
  }

  const overdueSales = await prisma.sale.findMany({
    where: {
      deletedAt: null,
      paidFully: false,
      remainingAmount: { gt: 0 },
      dueDate: { lt: today },
      shop: { status: 'ACTIVE', deletedAt: null },
    },
    include: {
      customer: true,
      device: true,
      shop: {
        include: {
          admins: { where: { deletedAt: null, isActive: true, telegramId: { not: '' }, telegramVerifiedAt: { not: null } } },
        },
      },
    },
  })

  for (const sale of overdueSales) {
    const daysLate = sale.dueDate ? Math.floor((today.getTime() - sale.dueDate.getTime()) / 86400000) : 0
    const msg = `🔴 Muddati o'tgan qarz to'lovi\n👤 ${sale.customer.name}\n📞 ${sale.customer.phone}\n📱 ${sale.device.model}\n💵 ${Number(sale.remainingAmount).toLocaleString()} so'm\n⏳ ${daysLate} kun kechikmoqda`
    for (const admin of sale.shop.admins) {
      const dedupeKey = `SALE_OVERDUE:${dayKey}:${admin.telegramId}:${sale.id}`
      await prisma.notification.upsert({
        where: { dedupeKey },
        update: {},
        create: {
          dedupeKey,
          shopId: sale.shopId,
          type: 'SALE_OVERDUE',
          message: msg,
          telegramId: admin.telegramId!,
          scheduledAt: new Date(),
          relatedId: sale.id,
          relatedType: 'Sale',
        },
      })
    }
  }

  // Flush pending Telegram notifications before the cron response completes.
  const delivery = await processPendingNotifications()

  const summary = {
    reminders: dueToday.length,
    overdue: overdue.length,
    saleReminders: salePaymentsDueToday.length,
    saleOverdue: overdueSales.length,
  }

  await recordOpsEvent({
    level: delivery.failed + delivery.cancelled > 0 ? 'WARN' : 'INFO',
    event: 'cron.reminders.completed',
    message: 'Reminders cron completed',
    status: 'ok',
    metadata: {
      ...summary,
      notificationsAttempted: delivery.attempted,
      notificationsSent: delivery.sent,
      notificationsFailed: delivery.failed,
      notificationsCancelled: delivery.cancelled,
      durationMs: Date.now() - startedAt,
    },
  })

  return Response.json(summary)
  } catch (error) {
    await recordOpsEvent({
      level: 'ERROR',
      event: 'cron.reminders.failed',
      message: 'Reminders cron failed',
      status: 'error',
      metadata: { error: error instanceof Error ? error.message : String(error), durationMs: Date.now() - startedAt },
    })
    return new Response('Cron failed', { status: 500 })
  }
}
