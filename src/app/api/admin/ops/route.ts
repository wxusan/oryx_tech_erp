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
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const guarded = await requireSuperAdmin()
    if (!guarded.ok) return guarded.response

    const url = new URL(req.url)
    const level = url.searchParams.get('level')
    const takeParam = Number(url.searchParams.get('take'))
    const take = Number.isFinite(takeParam) && takeParam > 0 ? Math.min(takeParam, 200) : 50
    const now = new Date()
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    const staleProcessingBefore = new Date(now.getTime() - 5 * 60 * 1000)
    const alertState = await prisma.opsAlertState.findUnique({
      where: { id: 'platform' },
      select: { alertWindowStartsAt: true, acknowledgedAt: true },
    })
    const activeSince = new Date(Math.max(
      since.getTime(),
      alertState?.alertWindowStartsAt.getTime() ?? since.getTime(),
    ))

    const [events, levelGroups, notifGroups, recentFailedNotifications, lastCron, lastCronFailure, oldestActionableNotification] =
      await Promise.all([
        prisma.opsEvent.findMany({
          where: {
            createdAt: { gte: activeSince },
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
          where: { createdAt: { gte: activeSince } },
          _count: { _all: true },
        }),
        prisma.notification.groupBy({
          by: ['status'],
          _count: { _all: true },
        }),
        prisma.notification.findMany({
          where: {
            OR: [
              { status: 'FAILED' },
              { status: 'CANCELLED', createdAt: { gte: activeSince } },
            ],
          },
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
          where: { event: 'cron.reminders.failed', createdAt: { gte: activeSince } },
          orderBy: { createdAt: 'desc' },
          select: { id: true, event: true, message: true, metadata: true, createdAt: true },
        }),
        prisma.notification.findFirst({
          where: {
            OR: [
              { status: 'PENDING', scheduledAt: { lte: now } },
              {
                status: 'FAILED',
                OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
              },
              {
                status: 'PROCESSING',
                OR: [{ lastAttemptAt: null }, { lastAttemptAt: { lte: staleProcessingBefore } }],
              },
            ],
          },
          orderBy: { createdAt: 'asc' },
          select: {
            status: true,
            createdAt: true,
            scheduledAt: true,
            nextAttemptAt: true,
            lastAttemptAt: true,
          },
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
    notificationCounts.CANCELLED = await prisma.notification.count({
      where: { status: 'CANCELLED', createdAt: { gte: activeSince } },
    })
    const oldestActionableAgeSeconds = oldestActionableNotification
      ? Math.max(0, Math.floor((now.getTime() - oldestActionableNotification.createdAt.getTime()) / 1000))
      : 0
    const notificationWarnings = [
      notificationCounts.PENDING > 100
        ? `Xabarnoma navbati katta: ${notificationCounts.PENDING} ta xabarnoma navbatda`
        : null,
      notificationCounts.FAILED > 0
        ? `Yuborilmagan xabarnomalar bor: ${notificationCounts.FAILED} ta`
        : null,
      notificationCounts.CANCELLED > 0
        ? `Bekor qilingan xabarnomalar bor: ${notificationCounts.CANCELLED} ta`
        : null,
      oldestActionableAgeSeconds > 15 * 60
        ? `Eng eski yuborilishi kerak bo'lgan bildirishnoma ${Math.floor(oldestActionableAgeSeconds / 60)} daqiqadan beri navbatda`
        : null,
    ].filter((item): item is string => item !== null)

    return ok({
      windowDays: 7,
      alertWindow: {
        startsAt: alertState?.alertWindowStartsAt ?? null,
        acknowledgedAt: alertState?.acknowledgedAt ?? null,
      },
      levelCounts,
      notificationCounts,
      notificationWarnings,
      queueHealth: {
        oldestActionableCreatedAt: oldestActionableNotification?.createdAt ?? null,
        oldestActionableAgeSeconds,
        oldestActionableStatus: oldestActionableNotification?.status ?? null,
      },
      events,
      recentFailedNotifications,
      lastCron,
      lastCronFailure,
      generatedAt: new Date().toISOString(),
    })
  } catch (err) {
    logger.error('[GET /api/admin/ops]', { event: 'api.route_error', error: err })
    return serverError()
  }
}
