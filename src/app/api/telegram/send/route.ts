/**
 * POST /api/telegram/send
 *
 * Internal endpoint that drains the PENDING notification queue.
 * Call this after every user-facing action that produces a notification:
 *   - device sale
 *   - new device added
 *   - nasiya created
 *   - nasiya payment received
 *
 * The endpoint itself is idempotent — calling it multiple times in quick
 * succession is safe; each notification row is updated to SENT/FAILED once
 * processed.
 *
 * Response:
 *   { sent: number, failed: number }
 */

import { processPendingNotifications } from '@/lib/notification-service'
import { hasValidInternalSecret, internalSecret } from '@/lib/api-auth'
import { logger } from '@/lib/logger'
import { recordOpsEvent } from '@/lib/server/ops-events'

export async function POST(request: Request): Promise<Response> {
  try {
    if (!internalSecret()) {
      return Response.json(
        { error: 'Internal secret sozlanmagan', sent: 0, failed: 0 },
        { status: 503 },
      )
    }

    if (!hasValidInternalSecret(request)) {
      return Response.json(
        { error: 'Unauthorized', sent: 0, failed: 0 },
        { status: 401 },
      )
    }

    const result = await processPendingNotifications()

    logger.info('telegram send drain complete', {
      event: 'telegram.send',
      route: '/api/telegram/send',
      status: result.failed + result.cancelled > 0 ? 'partial' : 'ok',
      ...result,
    })

    return Response.json(result, { status: 200 })
  } catch (error) {
    await recordOpsEvent({
      level: 'ERROR',
      event: 'telegram.send_failed',
      message: 'telegram/send route crashed',
      status: 'error',
      metadata: { error: error instanceof Error ? error.message : String(error) },
    })
    return Response.json(
      { error: 'Ichki server xatosi', sent: 0, failed: 0 },
      { status: 500 },
    )
  }
}
