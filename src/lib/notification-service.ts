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

    console.log(
      `[NotificationService] Queued notification id=${notification.id} type=${params.type} shop=${params.shopId} telegram=${params.telegramId}`,
    )

    // Attempt immediate delivery for notifications scheduled now or in the past.
    // Use the queue processor so the PROCESSING claim remains atomic with
    // every other worker that may be draining notifications at the same time.
    if (scheduledAt <= new Date()) {
      await processPendingNotifications()
    }
  } catch (error) {
    console.error('[NotificationService] queueNotification error:', error)
    // Do not re-throw — notification failure must never crash the main flow.
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
export async function processPendingNotifications(): Promise<{
  sent: number
  failed: number
}> {
  let sent = 0
  let failed = 0

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

        const ok = await sendTelegramMessage(
          notification.telegramId,
          notification.message,
        )

        if (ok) {
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
          failed++
          const attemptCount = notification.attemptCount + 1
          await prisma.notification.update({
            where: { id: notification.id },
            data: {
              status: attemptCount >= MAX_NOTIFICATION_ATTEMPTS ? 'CANCELLED' : 'FAILED',
              nextAttemptAt: attemptCount >= MAX_NOTIFICATION_ATTEMPTS
                ? null
                : new Date(Date.now() + nextAttemptDelayMs(attemptCount)),
              lastError: 'Telegram send failed',
            },
          })
        }
      } catch (innerError) {
        failed++
        console.error(
          `[NotificationService] Failed to process notification id=${notification.id}:`,
          innerError,
        )
        await prisma.notification.update({
          where: { id: notification.id },
          data:  {
            status: notification.attemptCount + 1 >= MAX_NOTIFICATION_ATTEMPTS ? 'CANCELLED' : 'FAILED',
            nextAttemptAt: notification.attemptCount + 1 >= MAX_NOTIFICATION_ATTEMPTS
              ? null
              : new Date(Date.now() + nextAttemptDelayMs(notification.attemptCount + 1)),
            lastError: innerError instanceof Error ? innerError.message : 'Unknown notification error',
          },
        })
      }
    }

    console.log(
      `[NotificationService] processPendingNotifications complete — sent=${sent}, failed=${failed}`,
    )
  } catch (error) {
    console.error(
      '[NotificationService] processPendingNotifications error:',
      error,
    )
  }

  return { sent, failed }
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
      console.log(
        `[NotificationService] No verified Telegram admins for shop=${shopId}`,
      )
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

    console.log(
      `[NotificationService] Queued for ${targets.length} admin(s) in shop=${shopId}`,
    )
  } catch (error) {
    console.error('[NotificationService] notifyShopAdmins error:', error)
  }
}
