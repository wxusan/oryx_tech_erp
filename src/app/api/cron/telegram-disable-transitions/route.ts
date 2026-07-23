import { type NextRequest } from 'next/server'

import { hasValidInternalSecret, internalSecret } from '@/lib/api-auth'
import { processDueTelegramDisableTransitions } from '@/lib/server/telegram-lifecycle'
import { recordOpsEvent } from '@/lib/server/ops-events'
import { initializeRequestAuditContext } from '@/lib/server/request-context'

export const maxDuration = 60
const MAX_BATCHES = 10
const RUN_BUDGET_MS = 45_000

export async function GET(request: NextRequest): Promise<Response> {
  await initializeRequestAuditContext(request.headers)
  if (!internalSecret()) {
    return new Response('Internal secret is not configured', { status: 503 })
  }
  if (!hasValidInternalSecret(request)) {
    return new Response('Unauthorized', { status: 401 })
  }

  try {
    const startedAt = Date.now()
    const summary = {
      selected: 0,
      processed: 0,
      failed: 0,
      identitiesCleared: 0,
      notificationsCancelled: 0,
      batches: 0,
      incomplete: false,
      durationMs: 0,
    }
    for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
      if (Date.now() - startedAt >= RUN_BUDGET_MS) {
        summary.incomplete = true
        break
      }
      const page = await processDueTelegramDisableTransitions({ limit: 100 })
      summary.batches += 1
      summary.selected += page.selected
      summary.processed += page.processed
      summary.failed += page.failed
      summary.identitiesCleared += page.identitiesCleared
      summary.notificationsCancelled += page.notificationsCancelled
      if (page.failed || page.processed < page.selected) {
        summary.incomplete = true
        break
      }
      if (!page.mayHaveMore) break
      if (batch === MAX_BATCHES - 1) summary.incomplete = true
    }
    summary.durationMs = Date.now() - startedAt

    if (summary.failed || summary.incomplete) {
      await recordOpsEvent({
        level: 'ERROR',
        event: 'cron.telegram_disable.partial',
        message: 'Telegram disable transition processing was incomplete',
        status: 'partial',
        metadata: { ...summary },
      })
      return Response.json(summary, { status: 503 })
    }
    await recordOpsEvent({
      level: 'INFO',
      event: 'cron.telegram_disable.completed',
      message: 'Telegram disable transitions processed',
      status: 'ok',
      metadata: { ...summary },
    })
    return Response.json(summary)
  } catch {
    await recordOpsEvent({
      level: 'ERROR',
      event: 'cron.telegram_disable.failed',
      message: 'Telegram disable transition cron failed',
      status: 'error',
    })
    return new Response('Internal Server Error', { status: 500 })
  }
}
