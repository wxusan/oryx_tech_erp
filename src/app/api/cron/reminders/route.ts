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
 *   "crons": [{ "path": "/api/cron/reminders", "schedule": "0 8 * * *" }]
 * }
 *
 * The route also accepts an Authorization header check so it can be called
 * by external cron services (e.g. cron-job.org) without a Vercel plan:
 *   Authorization: Bearer <CRON_SECRET>
 *
 * Response:
 *   { reminders: number, overdue: number }
 */

import { type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { hasValidInternalSecret, internalSecret } from '@/lib/api-auth'
import { processPendingNotifications } from '@/lib/notification-service'

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

  // Today's date range
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const dayKey = today.toISOString().slice(0, 10)

  // -------------------------------------------------------------------------
  // 1. Today's reminders — dueDate = today, status PENDING or PARTIAL
  // -------------------------------------------------------------------------

  const dueToday = await prisma.nasiyaSchedule.findMany({
    where: {
      OR: [
        { dueDate: { gte: today, lt: tomorrow } },
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
              admins: { where: { deletedAt: null, isActive: true, telegramId: { not: '' } } },
            },
          },
        },
      },
    },
  })

  for (const schedule of dueToday) {
    const { nasiya } = schedule
    const msg = `⏰ Bugungi to'lov eslatmasi\n👤 ${nasiya.customer.name}\n📞 ${nasiya.customer.phone}\n📱 ${nasiya.device.model}\n💵 ${Number(schedule.expectedAmount).toLocaleString()} so'm`
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
  // 2. Overdue — dueDate < today, status PENDING or PARTIAL
  // -------------------------------------------------------------------------

  const overdue = await prisma.nasiyaSchedule.findMany({
    where: {
      OR: [
        { dueDate: { lt: today } },
        { delayedUntil: { lt: today } },
      ],
      status: { in: ['PENDING', 'PARTIAL', 'DEFERRED'] },
      nasiya: {
        deletedAt: null,
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
              admins: { where: { deletedAt: null, isActive: true, telegramId: { not: '' } } },
            },
          },
        },
      },
    },
  })

  for (const schedule of overdue) {
    await prisma.nasiyaSchedule.update({
      where: { id: schedule.id },
      data: { status: 'OVERDUE' },
    })
    await prisma.nasiya.update({
      where: { id: schedule.nasiya.id },
      data: { status: 'OVERDUE' },
    })

    const daysLate = Math.floor((today.getTime() - schedule.dueDate.getTime()) / 86400000)
    const msg = `🔴 Muddati o'tgan to'lov\n👤 ${schedule.nasiya.customer.name}\n📞 ${schedule.nasiya.customer.phone}\n📱 ${schedule.nasiya.device.model}\n💵 ${Number(schedule.expectedAmount).toLocaleString()} so'm\n⏳ ${daysLate} kun kechikmoqda`
    for (const admin of schedule.nasiya.shop.admins) {
      const dedupeKey = `OVERDUE:${dayKey}:${admin.telegramId}:${schedule.id}`
      await prisma.notification.upsert({
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
          admins: { where: { deletedAt: null, isActive: true, telegramId: { not: '' } } },
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
          admins: { where: { deletedAt: null, isActive: true, telegramId: { not: '' } } },
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
  await processPendingNotifications()

  return Response.json({
    reminders: dueToday.length,
    overdue: overdue.length,
    saleReminders: salePaymentsDueToday.length,
    saleOverdue: overdueSales.length,
  })
}
