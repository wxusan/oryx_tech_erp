/**
 * GET /api/admin/ops — super-admin operational dashboard data.
 *
 * Returns recent OpsEvents, level counts, the notification queue breakdown,
 * recent failed/cancelled notifications, and the last cron run. Super admin only.
 *
 * Notification bodies (which contain customer PII) are deliberately omitted —
 * only type/status/error/timestamps are returned for triage.
 */

import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireSuperAdmin } from '@/lib/api-auth'
import { ok, serverError } from '@/lib/api-helpers'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const guarded = await requireSuperAdmin()
    if (!guarded.ok) return guarded.response

    const url = new URL(req.url)
    const level = url.searchParams.get('level')
    const takeParam = Number(url.searchParams.get('take'))
    const take = Number.isFinite(takeParam) && takeParam > 0 ? Math.min(takeParam, 200) : 50
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

    const [events, levelGroups, notifGroups, recentFailedNotifications, lastCron, lastCronFailure] =
      await Promise.all([
        prisma.opsEvent.findMany({
          where: {
            createdAt: { gte: since },
            ...(level === 'INFO' || level === 'WARN' || level === 'ERROR' ? { level } : {}),
          },
          orderBy: { createdAt: 'desc' },
          take,
          select: {
            id: true,
            level: true,
            event: true,
            message: true,
            shopId: true,
            status: true,
            errorCode: true,
            metadata: true,
            createdAt: true,
          },
        }),
        prisma.opsEvent.groupBy({
          by: ['level'],
          where: { createdAt: { gte: since } },
          _count: { _all: true },
        }),
        prisma.notification.groupBy({
          by: ['status'],
          _count: { _all: true },
        }),
        prisma.notification.findMany({
          where: { status: { in: ['FAILED', 'CANCELLED'] } },
          orderBy: { lastAttemptAt: 'desc' },
          take: 20,
          select: {
            id: true,
            type: true,
            status: true,
            shopId: true,
            attemptCount: true,
            lastError: true,
            lastAttemptAt: true,
            createdAt: true,
          },
        }),
        prisma.opsEvent.findFirst({
          where: { event: { in: ['cron.reminders.completed', 'cron.reminders.started'] } },
          orderBy: { createdAt: 'desc' },
          select: { id: true, event: true, level: true, message: true, metadata: true, createdAt: true },
        }),
        prisma.opsEvent.findFirst({
          where: { event: 'cron.reminders.failed' },
          orderBy: { createdAt: 'desc' },
          select: { id: true, event: true, message: true, metadata: true, createdAt: true },
        }),
      ])

    const levelCounts = { INFO: 0, WARN: 0, ERROR: 0 } as Record<string, number>
    for (const group of levelGroups) levelCounts[group.level] = group._count._all

    const notificationCounts: Record<string, number> = {
      PENDING: 0,
      PROCESSING: 0,
      SENT: 0,
      FAILED: 0,
      CANCELLED: 0,
    }
    for (const group of notifGroups) notificationCounts[group.status] = group._count._all
    const notificationWarnings = [
      notificationCounts.PENDING > 100
        ? `Bildirishnoma navbati katta: ${notificationCounts.PENDING} ta PENDING`
        : null,
      notificationCounts.FAILED > 0
        ? `FAILED bildirishnomalar bor: ${notificationCounts.FAILED} ta`
        : null,
      notificationCounts.CANCELLED > 0
        ? `CANCELLED bildirishnomalar bor: ${notificationCounts.CANCELLED} ta`
        : null,
    ].filter((item): item is string => item !== null)

    return ok({
      windowDays: 7,
      levelCounts,
      notificationCounts,
      notificationWarnings,
      events,
      recentFailedNotifications,
      lastCron,
      lastCronFailure,
      generatedAt: new Date().toISOString(),
    })
  } catch (err) {
    console.error('[GET /api/admin/ops]', err)
    return serverError()
  }
}
