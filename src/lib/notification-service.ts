/**
 * Notification service for Oryx ERP.
 *
 * Responsibilities:
 *   1. queueNotification  — persist a PENDING notification to the DB
 *   2. processPendingNotifications — drain the queue and fire Telegram messages
 *   3. notifyShopAdmins   — convenience wrapper for shop-wide broadcasts
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { prisma } from '@/lib/prisma'
import { sendTelegramMessage } from './telegram'
import { logger } from '@/lib/logger'
import { recordOpsEvent } from '@/lib/server/ops-events'

const MAX_NOTIFICATION_ATTEMPTS = 5

// How long a row may sit in PROCESSING before it is considered stale and
// reclaimed. Guards against rows stuck forever if the process crashes between
// claim and final update.
const STALE_PROCESSING_MS = 5 * 60 * 1000

function nextAttemptDelayMs(attemptCount: number): number {
  return Math.min(60 * 60 * 1000, 2 ** Math.max(0, attemptCount - 1) * 60 * 1000)
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface QueueNotificationParams {
  shopId: string
  type: string
  message: string
  telegramId: string
  scheduledAt?: Date
  relatedId?: string
  relatedType?: string
}

// ---------------------------------------------------------------------------
// queueNotification
// ---------------------------------------------------------------------------

/**
 * Persist a new PENDING notification row and immediately attempt delivery.
 *
 * The message is saved first so it is never lost even if the Telegram call
 * fails — the cron job (or next processPendingNotifications call) will retry.
 */
export async function queueNotification(
  params: QueueNotificationParams,
): Promise<void> {
  try {
    const scheduledAt = params.scheduledAt ?? new Date()

    const notification = await prisma.notification.create({
      data: {
        shopId:      params.shopId,
        type:        params.type,
        message:     params.message,
        telegramId:  params.telegramId,
        status:      'PENDING',
        scheduledAt,
        relatedId:   params.relatedId ?? null,
        relatedType: params.relatedType ?? null,
      },
    })

    logger.info('notification queued', {
      event: 'notification.queued',
      shopId: params.shopId,
      entityType: 'Notification',
      entityId: notification.id,
      status: params.type,
    })

    // Attempt immediate delivery for notifications scheduled now or in the past.
    // Use the queue processor so the PROCESSING claim remains atomic with
    // every other worker that may be draining notifications at the same time.
    if (scheduledAt <= new Date()) {
      await processPendingNotifications()
    }
  } catch (error) {
    // Do not re-throw — notification failure must never crash the main flow.
    await recordOpsEvent({
      level: 'ERROR',
      event: 'notification.queue_failed',
      message: 'Failed to queue notification',
      shopId: params.shopId,
      status: params.type,
      metadata: { error: error instanceof Error ? error.message : String(error) },
    })
  }
}

// ---------------------------------------------------------------------------
// processPendingNotifications
// ---------------------------------------------------------------------------

/**
 * Fetch due PENDING/FAILED notifications, send them via Telegram, and update
 * their status to SENT or FAILED. FAILED rows stay retryable on the next drain.
 *
 * Call this from:
 *   - POST /api/telegram/send   (after every sale / nasiya / payment)
 *   - GET  /api/cron/reminders  (scheduled cron job)
 */
export interface NotificationRunSummary {
  attempted: number
  sent: number
  failed: number
  cancelled: number
  durationMs: number
}

export async function processPendingNotifications(): Promise<NotificationRunSummary> {
  const startedAt = Date.now()
  let attempted = 0
  let sent = 0
  let failed = 0
  let cancelled = 0

  const finalize = (): NotificationRunSummary => ({
    attempted,
    sent,
    failed,
    cancelled,
    durationMs: Date.now() - startedAt,
  })

  try {
    const now = new Date()
    const staleBefore = new Date(now.getTime() - STALE_PROCESSING_MS)

    const pending = await prisma.notification.findMany({
      where: {
        OR: [
          // Normal due PENDING/FAILED rows (retry semantics preserved).
          {
            status:      { in: ['PENDING', 'FAILED'] },
            scheduledAt: { lte: now },
            OR: [
              { nextAttemptAt: null },
              { nextAttemptAt: { lte: now } },
            ],
          },
          // Reclaim rows stuck in PROCESSING (e.g. after a crash between
          // claim and final update) once they are older than the threshold.
          {
            status:        'PROCESSING',
            lastAttemptAt: { lte: staleBefore },
          },
        ],
      },
      orderBy: { scheduledAt: 'asc' },
      take: 100,
    })

    for (const notification of pending) {
      try {
        const claim = await prisma.notification.updateMany({
          where: {
            id: notification.id,
            OR: [
              { status: { in: ['PENDING', 'FAILED'] } },
              { status: 'PROCESSING', lastAttemptAt: { lte: staleBefore } },
            ],
          },
          data: {
            status: 'PROCESSING',
            attemptCount: { increment: 1 },
            lastAttemptAt: new Date(),
          },
        })
        if (claim.count !== 1) continue
        attempted++

        const result = await sendTelegramMessage(
          notification.telegramId,
          notification.message,
        )

        if (result.ok) {
          sent++
          await prisma.notification.update({
            where: { id: notification.id },
            data:  {
              status: 'SENT',
              sentAt: new Date(),
              nextAttemptAt: null,
              lastError: null,
            },
          })
        } else {
          const attemptCount = notification.attemptCount + 1
          const exhausted = attemptCount >= MAX_NOTIFICATION_ATTEMPTS
          // Keep the Telegram error code/description (NOT the token) for triage.
          const lastError = result.description
            ? `Telegram ${result.errorCode ?? ''}: ${result.description}`.trim()
            : 'Telegram send failed'
          if (exhausted) cancelled++
          else failed++
          await prisma.notification.update({
            where: { id: notification.id },
            data: {
              status: exhausted ? 'CANCELLED' : 'FAILED',
              nextAttemptAt: exhausted ? null : new Date(Date.now() + nextAttemptDelayMs(attemptCount)),
              lastError,
            },
          })
          // Only alert once — when retries are exhausted and the message is dropped.
          if (exhausted) {
            await recordOpsEvent({
              level: 'ERROR',
              event: 'notification.cancelled',
              message: 'Notification cancelled after max attempts',
              shopId: notification.shopId,
              entityType: 'Notification',
              entityId: notification.id,
              status: notification.type,
              errorCode: result.errorCode ?? undefined,
              metadata: { attempts: attemptCount, reason: result.description ?? 'send failed' },
            })
          }
        }
      } catch (innerError) {
        const attemptCount = notification.attemptCount + 1
        const exhausted = attemptCount >= MAX_NOTIFICATION_ATTEMPTS
        if (exhausted) cancelled++
        else failed++
        await prisma.notification.update({
          where: { id: notification.id },
          data:  {
            status: exhausted ? 'CANCELLED' : 'FAILED',
            nextAttemptAt: exhausted ? null : new Date(Date.now() + nextAttemptDelayMs(attemptCount)),
            lastError: innerError instanceof Error ? innerError.message : 'Unknown notification error',
          },
        })
        await recordOpsEvent({
          level: 'ERROR',
          event: exhausted ? 'notification.cancelled' : 'notification.process_error',
          message: 'Error while processing a notification',
          shopId: notification.shopId,
          entityType: 'Notification',
          entityId: notification.id,
          status: notification.type,
          metadata: { attempts: attemptCount, error: innerError instanceof Error ? innerError.message : String(innerError) },
        })
      }
    }

    if (attempted > 0) {
      logger.info('notification run complete', {
        event: 'notification.run',
        status: failed + cancelled > 0 ? 'partial' : 'ok',
        ...finalize(),
      })
    }
  } catch (error) {
    await recordOpsEvent({
      level: 'ERROR',
      event: 'notification.run_failed',
      message: 'processPendingNotifications crashed',
      status: 'error',
      metadata: { error: error instanceof Error ? error.message : String(error), ...finalize() },
    })
  }

  return finalize()
}

// ---------------------------------------------------------------------------
// notifyShopAdmins
// ---------------------------------------------------------------------------

/**
 * Queue the same message for every active ShopAdmin of a shop who has a
 * verified telegramId configured. Silently skips unverified admins.
 */
export async function notifyShopAdmins(
  shopId: string,
  message: string,
  type: string,
  relatedId?: string,
  relatedType?: string,
): Promise<void> {
  try {
    const admins: Array<{ telegramId: string | null }> = await prisma.shopAdmin.findMany({
      where: {
        shopId,
        isActive: true,
        telegramId: { not: null },
        telegramVerifiedAt: { not: null },
        deletedAt: null,
      },
      select: { telegramId: true },
    })

    const targets = admins.filter(
      (a): a is { telegramId: string } => a.telegramId !== null,
    )

    if (targets.length === 0) {
      logger.info('no verified telegram admins for shop', {
        event: 'notification.no_recipients',
        shopId,
        status: type,
      })
      return
    }

    await Promise.all(
      targets.map((admin) =>
        queueNotification({
          shopId,
          type,
          message,
          telegramId: admin.telegramId,
          relatedId,
          relatedType,
        }),
      ),
    )

    logger.info('queued notification for shop admins', {
      event: 'notification.broadcast',
      shopId,
      status: type,
      attempt: targets.length,
    })
  } catch (error) {
    await recordOpsEvent({
      level: 'ERROR',
      event: 'notification.broadcast_failed',
      message: 'notifyShopAdmins failed',
      shopId,
      status: type,
      metadata: { error: error instanceof Error ? error.message : String(error) },
    })
  }
}
