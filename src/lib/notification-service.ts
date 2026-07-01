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
      `[NotificationService] Queued notification type=${params.type} shop=${params.shopId} telegram=${params.telegramId}`,
    )

    // Attempt immediate delivery for notifications scheduled now or in the past.
    if (scheduledAt <= new Date()) {
      const sent = await sendTelegramMessage(params.telegramId, params.message)
      const newStatus = sent ? 'SENT' : 'FAILED'

      await prisma.notification.update({
        where: { id: notification.id },
        data: {
          status: newStatus,
          sentAt: sent ? new Date() : null,
          attemptCount: { increment: 1 },
          lastAttemptAt: new Date(),
          nextAttemptAt: sent ? null : new Date(Date.now() + nextAttemptDelayMs(1)),
        },
      })

      console.log(
        `[NotificationService] Immediate send result: ${newStatus} for telegram=${params.telegramId}`,
      )
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
    const pending = await prisma.notification.findMany({
      where: {
        status:      { in: ['PENDING', 'FAILED'] },
        scheduledAt: { lte: new Date() },
        OR: [
          { nextAttemptAt: null },
          { nextAttemptAt: { lte: new Date() } },
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
            status: { in: ['PENDING', 'FAILED'] },
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
 * telegramId configured.  Silently skips admins without a telegramId.
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
        isActive:   true,
        telegramId: { not: null },
        deletedAt:  null,
      },
      select: { telegramId: true },
    })

    const targets = admins.filter(
      (a): a is { telegramId: string } => a.telegramId !== null,
    )

    if (targets.length === 0) {
      console.log(
        `[NotificationService] No admins with telegramId for shop=${shopId}`,
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
