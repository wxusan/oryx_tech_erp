/**
 * GET /api/cron/reminders
 *
 * Cron job (safe to run every ~10 min — all generation is idempotent) that:
 *   1. Generates a reminder for every NasiyaSchedule / Sale due today.
 *   2. Generates an overdue alert for every schedule/sale past its due date
 *      that is still unpaid, and marks them OVERDUE.
 *   3. Drains the notification queue, delivering any messages that are now due.
 *
 * PLANNED reminders (due-today + overdue) are NOT sent immediately: each is
 * scheduled at 11:00–11:30 Asia/Tashkent with a deterministic per-notification
 * jitter (see scheduledReminderSendAt), so they never all fire in the same
 * second. A later cron run inside that window delivers them. IMMEDIATE events
 * (sale/nasiya/payment/device) are queued with scheduledAt = now elsewhere and
 * are unaffected.
 *
 * Vercel cron configuration (vercel.json):
 * {
 *   "crons": [{ "path": "/api/cron/reminders", "schedule": "*\/10 * * * *" }]
 * }
 * Runs every 10 minutes (UTC). Idempotent: dedupeKey guarantees one message per
 * (day, admin, schedule/sale); the drain only sends rows whose jittered
 * scheduledAt has arrived. Sub-daily cron needs Vercel Pro or an external
 * scheduler hitting this endpoint with the CRON_SECRET bearer token.
 *
 * Vercel Cron sends Authorization: Bearer <CRON_SECRET> automatically when the
 * env var is configured. The same header can be used by external schedulers:
 *   Authorization: Bearer <CRON_SECRET>
 *
 * Response:
 *   { reminders, overdue, saleReminders, saleOverdue }
 */

import { type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { hasValidInternalSecret, internalSecret } from '@/lib/api-auth'
import { processPendingNotifications } from '@/lib/notification-service'
import { scheduledReminderSendAt } from '@/lib/notification-schedule'
import { invalidateShopOverdueCron } from '@/lib/server/cache-tags'
import { tashkentDayRange } from '@/lib/timezone'
import { recordOpsEvent } from '@/lib/server/ops-events'
import { getUsdUzsRate } from '@/lib/server/currency'
import type { CurrencyCode, CurrencyContext } from '@/lib/currency'
import {
  nasiyaDueTodayMessage,
  nasiyaOverdueMessage,
  saleDueTodayMessage,
  saleOverdueMessage,
} from '@/lib/telegram-templates'

export const maxDuration = 60

function outstandingAmount(expected: unknown, paid: unknown) {
  return Math.max(0, Number(expected) - Number(paid ?? 0))
}

let usdUzsRateForRun: Promise<number | null> | null = null

function getUsdUzsRateForRun() {
  usdUzsRateForRun ??= getUsdUzsRate().catch(() => null)
  return usdUzsRateForRun
}

async function reminderCurrency(shop: { preferredCurrency: CurrencyCode }): Promise<CurrencyContext> {
  if (shop.preferredCurrency !== 'USD') return { currency: 'UZS', usdUzsRate: null }
  return { currency: 'USD', usdUzsRate: await getUsdUzsRateForRun() }
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
  usdUzsRateForRun = null
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
    const msg = nasiyaDueTodayMessage({
      customerName: nasiya.customer.name,
      customerPhone: nasiya.customer.phone,
      device: {
        deviceModel: nasiya.device.model,
        storage: nasiya.device.storage,
        color: nasiya.device.color,
        imei: nasiya.device.imei,
      },
      month: schedule.monthNumber,
      amountDue: outstandingAmount(schedule.expectedAmount, schedule.paidAmount),
      dueDate: schedule.delayedUntil ?? schedule.dueDate,
      currency: await reminderCurrency(nasiya.shop),
    })
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
          scheduledAt: scheduledReminderSendAt(dedupeKey),
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

  // Shops where a schedule/nasiya actually flipped to OVERDUE this run. Only
  // these need a cache bust — repeated (idempotent) cron runs must not thrash.
  const transitionedShopIds = new Set<string>()

  for (const schedule of overdue) {
    const effectiveDue = schedule.delayedUntil ?? schedule.dueDate
    const daysLate = Math.floor((today.getTime() - effectiveDue.getTime()) / 86400000)
    const msg = nasiyaOverdueMessage({
      customerName: schedule.nasiya.customer.name,
      customerPhone: schedule.nasiya.customer.phone,
      device: {
        deviceModel: schedule.nasiya.device.model,
        storage: schedule.nasiya.device.storage,
        color: schedule.nasiya.device.color,
        imei: schedule.nasiya.device.imei,
      },
      month: schedule.monthNumber,
      amountDue: outstandingAmount(schedule.expectedAmount, schedule.paidAmount),
      dueDate: effectiveDue,
      daysLate,
      currency: await reminderCurrency(schedule.nasiya.shop),
    })
    const transitioned = await prisma.$transaction(async (tx) => {
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
            scheduledAt: scheduledReminderSendAt(dedupeKey),
            relatedId: schedule.id,
            relatedType: 'NasiyaSchedule',
          },
        })
      }

      const scheduleUpdate = await tx.nasiyaSchedule.updateMany({
        where: { id: schedule.id, status: { in: ['PENDING', 'PARTIAL', 'DEFERRED'] } },
        data: { status: 'OVERDUE' },
      })
      const nasiyaUpdate = await tx.nasiya.updateMany({
        where: { id: schedule.nasiya.id, status: { not: 'OVERDUE' } },
        data: { status: 'OVERDUE' },
      })
      return scheduleUpdate.count > 0 || nasiyaUpdate.count > 0
    })
    if (transitioned) transitionedShopIds.add(schedule.nasiya.shopId)
  }

  // Bust caches only for shops whose nasiya schedules / parent status ACTUALLY
  // flipped to OVERDUE this run, so the list, dashboard and reports refresh
  // immediately — while the frequent cron cadence never thrashes caches on
  // idempotent no-op runs.
  for (const overdueShopId of transitionedShopIds) {
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
    const msg = saleDueTodayMessage({
      customerName: sale.customer.name,
      customerPhone: sale.customer.phone,
      device: {
        deviceModel: sale.device.model,
        storage: sale.device.storage,
        color: sale.device.color,
        imei: sale.device.imei,
      },
      remainingAmount: Number(sale.remainingAmount),
      dueDate: sale.dueDate ?? new Date(),
      currency: await reminderCurrency(sale.shop),
    })
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
          scheduledAt: scheduledReminderSendAt(dedupeKey),
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
      reminderEnabled: true,
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
    const msg = saleOverdueMessage({
      customerName: sale.customer.name,
      customerPhone: sale.customer.phone,
      device: {
        deviceModel: sale.device.model,
        storage: sale.device.storage,
        color: sale.device.color,
        imei: sale.device.imei,
      },
      remainingAmount: Number(sale.remainingAmount),
      dueDate: sale.dueDate ?? new Date(),
      daysLate,
      currency: await reminderCurrency(sale.shop),
    })
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
          scheduledAt: scheduledReminderSendAt(dedupeKey),
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
      notificationsSentWithImage: delivery.sentWithImage,
      notificationsFailed: delivery.failed,
      notificationsCancelled: delivery.cancelled,
      overdueTransitions: transitionedShopIds.size,
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
