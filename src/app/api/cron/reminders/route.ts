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
 *   "crons": [{ "path": "/api/cron/reminders", "schedule": "35 6 * * *" }]
 * }
 * Runs once daily at 06:35 UTC (11:35 Asia/Tashkent) — see docs/cron-jobs.md
 * for why (Vercel Hobby plan rejects sub-daily cron at deploy time).
 * Idempotent: dedupeKey guarantees one message per (day, admin, schedule/sale);
 * the drain only sends rows whose jittered scheduledAt has arrived. Sub-daily
 * cron needs Vercel Pro or an external scheduler hitting this endpoint with
 * the CRON_SECRET bearer token.
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
import { tashkentDayRange, tashkentDaysUntil, matchesEarlyReminderDay } from '@/lib/timezone'
import { recordOpsEvent } from '@/lib/server/ops-events'
import { getUsdUzsRate } from '@/lib/server/currency'
import { contractScheduleOutstanding } from '@/lib/nasiya-contract'
import type { CurrencyCode, CurrencyContext } from '@/lib/currency'
import { cleanupExpiredChangeEvents } from '@/lib/server/change-events'
import { transitionNasiyaToOverdue } from '@/lib/server/overdue-transition'
import {
  nasiyaDueTodayMessage,
  nasiyaOverdueMessage,
  nasiyaEarlyReminderMessage,
  saleDueTodayMessage,
  saleOverdueMessage,
  saleEarlyReminderMessage,
  supplierPayableDueTodayMessage,
  supplierPayableOverdueMessage,
  supplierPayableEarlyReminderMessage,
} from '@/lib/telegram-templates'

export const maxDuration = 60

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
      amountDue: contractScheduleOutstanding(Number(schedule.contractExpectedAmount), Number(schedule.contractPaidAmount), nasiya.contractCurrency),
      contractCurrency: nasiya.contractCurrency,
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
      amountDue: contractScheduleOutstanding(Number(schedule.contractExpectedAmount), Number(schedule.contractPaidAmount), schedule.nasiya.contractCurrency),
      contractCurrency: schedule.nasiya.contractCurrency,
      dueDate: effectiveDue,
      daysLate,
      currency: await reminderCurrency(schedule.nasiya.shop),
    })
    const notifications = schedule.nasiya.shop.admins.map((admin) => {
      const dedupeKey = `OVERDUE:${dayKey}:${admin.telegramId}:${schedule.id}`
      return {
        dedupeKey,
        message: msg,
        telegramId: admin.telegramId!,
        scheduledAt: scheduledReminderSendAt(dedupeKey),
      }
    })
    const transitioned = await transitionNasiyaToOverdue({
      scheduleId: schedule.id,
      nasiyaId: schedule.nasiya.id,
      shopId: schedule.nasiya.shopId,
      notifications,
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

  // -------------------------------------------------------------------------
  // 2b. Nasiya early reminders — "Ertaroq eslatilsinmi?": an extra reminder
  //    N days before a schedule's due date, IN ADDITION TO (not instead of)
  //    the due-day reminder above. `earlyReminderDays` varies per nasiya, so
  //    it can't be expressed as a single DB date range — the window below is
  //    just a bound (tomorrow..+60d, the UI's max), refined with exact
  //    day-math in JS. A schedule whose early date has already passed never
  //    matches "today", so it's silently skipped (no backfill) while the
  //    due-day reminder is untouched.
  // -------------------------------------------------------------------------

  const earlyWindowEnd = new Date(tomorrow)
  earlyWindowEnd.setUTCDate(earlyWindowEnd.getUTCDate() + 61)

  const earlyCandidates = await prisma.nasiyaSchedule.findMany({
    where: {
      OR: [
        { delayedUntil: null, dueDate: { gte: tomorrow, lt: earlyWindowEnd } },
        { delayedUntil: { gte: tomorrow, lt: earlyWindowEnd } },
      ],
      status: { in: ['PENDING', 'PARTIAL', 'DEFERRED'] },
      nasiya: {
        deletedAt: null,
        reminderEnabled: true,
        earlyReminderEnabled: true,
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

  let earlyReminderCount = 0
  for (const schedule of earlyCandidates) {
    const { nasiya } = schedule
    const effectiveDue = schedule.delayedUntil ?? schedule.dueDate
    const daysUntil = tashkentDaysUntil(effectiveDue, today)
    if (!matchesEarlyReminderDay(daysUntil, nasiya.earlyReminderDays)) continue
    earlyReminderCount++
    const msg = nasiyaEarlyReminderMessage({
      customerName: nasiya.customer.name,
      customerPhone: nasiya.customer.phone,
      device: {
        deviceModel: nasiya.device.model,
        storage: nasiya.device.storage,
        color: nasiya.device.color,
        imei: nasiya.device.imei,
      },
      month: schedule.monthNumber,
      amountDue: contractScheduleOutstanding(Number(schedule.contractExpectedAmount), Number(schedule.contractPaidAmount), nasiya.contractCurrency),
      contractCurrency: nasiya.contractCurrency,
      dueDate: effectiveDue,
      daysLeft: daysUntil,
      currency: await reminderCurrency(nasiya.shop),
    })
    for (const admin of nasiya.shop.admins) {
      const dedupeKey = `EARLY_REMINDER:${dayKey}:${admin.telegramId}:${schedule.id}`
      await prisma.notification.upsert({
        where: { dedupeKey },
        update: {},
        create: {
          dedupeKey,
          shopId: nasiya.shopId,
          type: 'EARLY_REMINDER',
          message: msg,
          telegramId: admin.telegramId!,
          scheduledAt: scheduledReminderSendAt(dedupeKey),
          relatedId: schedule.id,
          relatedType: 'NasiyaSchedule',
        },
      })
    }
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

  // -------------------------------------------------------------------------
  // 3b. Sale early reminders — same mechanism as nasiya early reminders above,
  //    for a later-payment cash sale's single dueDate.
  // -------------------------------------------------------------------------

  const saleEarlyCandidates = await prisma.sale.findMany({
    where: {
      deletedAt: null,
      paidFully: false,
      remainingAmount: { gt: 0 },
      reminderEnabled: true,
      earlyReminderEnabled: true,
      dueDate: { gte: tomorrow, lt: earlyWindowEnd },
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

  let saleEarlyReminderCount = 0
  for (const sale of saleEarlyCandidates) {
    if (!sale.dueDate) continue
    const daysUntil = tashkentDaysUntil(sale.dueDate, today)
    if (!matchesEarlyReminderDay(daysUntil, sale.earlyReminderDays)) continue
    saleEarlyReminderCount++
    const msg = saleEarlyReminderMessage({
      customerName: sale.customer.name,
      customerPhone: sale.customer.phone,
      device: {
        deviceModel: sale.device.model,
        storage: sale.device.storage,
        color: sale.device.color,
        imei: sale.device.imei,
      },
      remainingAmount: Number(sale.remainingAmount),
      dueDate: sale.dueDate,
      daysLeft: daysUntil,
      currency: await reminderCurrency(sale.shop),
    })
    for (const admin of sale.shop.admins) {
      const dedupeKey = `SALE_EARLY_REMINDER:${dayKey}:${admin.telegramId}:${sale.id}`
      await prisma.notification.upsert({
        where: { dedupeKey },
        update: {},
        create: {
          dedupeKey,
          shopId: sale.shopId,
          type: 'SALE_EARLY_REMINDER',
          message: msg,
          telegramId: admin.telegramId!,
          scheduledAt: scheduledReminderSendAt(dedupeKey),
          relatedId: sale.id,
          relatedType: 'Sale',
        },
      })
    }
  }

  // -------------------------------------------------------------------------
  // 4. Supplier payable reminders ("Olib-sotdim" — money WE owe an external
  //    supplier). Mirrors the nasiya/sale due-today + overdue + early-reminder
  //    pattern above exactly, on the SupplierPayable table. PAID/CANCELLED
  //    payables are never selected (status filters below), so marking one
  //    paid stops its reminders immediately with no separate cleanup step.
  // -------------------------------------------------------------------------

  const supplierPayableDueToday = await prisma.supplierPayable.findMany({
    where: {
      deletedAt: null,
      status: 'PENDING',
      reminderEnabled: true,
      dueDate: { gte: today, lt: tomorrow },
      shop: { status: 'ACTIVE', deletedAt: null },
    },
    include: {
      device: true,
      shop: {
        include: {
          admins: { where: { deletedAt: null, isActive: true, telegramId: { not: '' }, telegramVerifiedAt: { not: null } } },
        },
      },
    },
  })

  for (const payable of supplierPayableDueToday) {
    const msg = supplierPayableDueTodayMessage({
      device: {
        deviceModel: payable.device.model,
        storage: payable.device.storage,
        color: payable.device.color,
        imei: payable.device.imei,
      },
      supplierName: payable.supplierName,
      supplierPhone: payable.supplierPhone,
      amount: Number(payable.contractAmount),
      contractCurrency: payable.contractCurrency,
      dueDate: payable.dueDate,
      currency: await reminderCurrency(payable.shop),
    })
    for (const admin of payable.shop.admins) {
      const dedupeKey = `SUPPLIER_PAYABLE_REMINDER:${dayKey}:${admin.telegramId}:${payable.id}`
      await prisma.notification.upsert({
        where: { dedupeKey },
        update: {},
        create: {
          dedupeKey,
          shopId: payable.shopId,
          type: 'SUPPLIER_PAYABLE_REMINDER',
          message: msg,
          telegramId: admin.telegramId!,
          scheduledAt: scheduledReminderSendAt(dedupeKey),
          relatedId: payable.id,
          relatedType: 'SupplierPayable',
        },
      })
    }
  }

  const supplierPayableOverdue = await prisma.supplierPayable.findMany({
    where: {
      deletedAt: null,
      status: { in: ['PENDING', 'OVERDUE'] },
      reminderEnabled: true,
      dueDate: { lt: today },
      shop: { status: 'ACTIVE', deletedAt: null },
    },
    include: {
      device: true,
      shop: {
        include: {
          admins: { where: { deletedAt: null, isActive: true, telegramId: { not: '' }, telegramVerifiedAt: { not: null } } },
        },
      },
    },
  })

  for (const payable of supplierPayableOverdue) {
    const daysLate = Math.floor((today.getTime() - payable.dueDate.getTime()) / 86400000)
    const msg = supplierPayableOverdueMessage({
      device: {
        deviceModel: payable.device.model,
        storage: payable.device.storage,
        color: payable.device.color,
        imei: payable.device.imei,
      },
      supplierName: payable.supplierName,
      supplierPhone: payable.supplierPhone,
      amount: Number(payable.contractAmount),
      contractCurrency: payable.contractCurrency,
      dueDate: payable.dueDate,
      daysLate,
      currency: await reminderCurrency(payable.shop),
    })
    for (const admin of payable.shop.admins) {
      const dedupeKey = `SUPPLIER_PAYABLE_OVERDUE:${dayKey}:${admin.telegramId}:${payable.id}`
      await prisma.notification.upsert({
        where: { dedupeKey },
        update: {},
        create: {
          dedupeKey,
          shopId: payable.shopId,
          type: 'SUPPLIER_PAYABLE_OVERDUE',
          message: msg,
          telegramId: admin.telegramId!,
          scheduledAt: scheduledReminderSendAt(dedupeKey),
          relatedId: payable.id,
          relatedType: 'SupplierPayable',
        },
      })
    }
    if (payable.status !== 'OVERDUE') {
      await prisma.$transaction(async (tx) => {
        const changed = await tx.supplierPayable.updateMany({
          where: { id: payable.id, status: 'PENDING' },
          data: { status: 'OVERDUE' },
        })
        if (changed.count > 0) {
          await tx.changeEvent.create({
            data: {
              scopeType: 'SHOP',
              scopeId: payable.shopId,
              domain: 'olibSotdim',
              entityType: 'SupplierPayable',
              entityId: payable.id,
              operation: 'updated',
              mutationKind: 'supplierPayable.overdue',
            },
          })
        }
      })
    }
  }

  const supplierPayableEarlyCandidates = await prisma.supplierPayable.findMany({
    where: {
      deletedAt: null,
      status: 'PENDING',
      reminderEnabled: true,
      earlyReminderEnabled: true,
      dueDate: { gte: tomorrow, lt: earlyWindowEnd },
      shop: { status: 'ACTIVE', deletedAt: null },
    },
    include: {
      device: true,
      shop: {
        include: {
          admins: { where: { deletedAt: null, isActive: true, telegramId: { not: '' }, telegramVerifiedAt: { not: null } } },
        },
      },
    },
  })

  let supplierPayableEarlyReminderCount = 0
  for (const payable of supplierPayableEarlyCandidates) {
    const daysUntil = tashkentDaysUntil(payable.dueDate, today)
    if (!matchesEarlyReminderDay(daysUntil, payable.earlyReminderDays)) continue
    supplierPayableEarlyReminderCount++
    const msg = supplierPayableEarlyReminderMessage({
      device: {
        deviceModel: payable.device.model,
        storage: payable.device.storage,
        color: payable.device.color,
        imei: payable.device.imei,
      },
      supplierName: payable.supplierName,
      supplierPhone: payable.supplierPhone,
      amount: Number(payable.contractAmount),
      contractCurrency: payable.contractCurrency,
      dueDate: payable.dueDate,
      daysLeft: daysUntil,
      currency: await reminderCurrency(payable.shop),
    })
    for (const admin of payable.shop.admins) {
      const dedupeKey = `SUPPLIER_PAYABLE_EARLY_REMINDER:${dayKey}:${admin.telegramId}:${payable.id}`
      await prisma.notification.upsert({
        where: { dedupeKey },
        update: {},
        create: {
          dedupeKey,
          shopId: payable.shopId,
          type: 'SUPPLIER_PAYABLE_EARLY_REMINDER',
          message: msg,
          telegramId: admin.telegramId!,
          scheduledAt: scheduledReminderSendAt(dedupeKey),
          relatedId: payable.id,
          relatedType: 'SupplierPayable',
        },
      })
    }
  }

  // Flush pending Telegram notifications before the cron response completes.
  const delivery = await processPendingNotifications()
  const expiredChanges = await cleanupExpiredChangeEvents()

  const summary = {
    reminders: dueToday.length,
    overdue: overdue.length,
    saleReminders: salePaymentsDueToday.length,
    saleOverdue: overdueSales.length,
    earlyReminders: earlyReminderCount,
    saleEarlyReminders: saleEarlyReminderCount,
    supplierPayableReminders: supplierPayableDueToday.length,
    supplierPayableOverdue: supplierPayableOverdue.length,
    supplierPayableEarlyReminders: supplierPayableEarlyReminderCount,
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
      expiredChangeEventsDeleted: expiredChanges.count,
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
