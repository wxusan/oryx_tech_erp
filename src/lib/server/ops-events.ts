import 'server-only'

import { prisma } from '@/lib/prisma'
import { logger, redact, type LogLevel } from '@/lib/logger'

/**
 * Persist a system/ops event AND emit a structured log line.
 *
 * Best-effort: a failure to write the OpsEvent row must NEVER break the caller
 * (a cron run or payment flow), so this swallows its own errors after logging.
 *
 * Do NOT pass secrets, full request bodies, or signed private URLs in metadata —
 * it is redacted defensively but kept small on purpose.
 */

type OpsLevel = 'INFO' | 'WARN' | 'ERROR'
type ActorType = 'SUPER_ADMIN' | 'SHOP_ADMIN'

export interface OpsEventInput {
  level?: OpsLevel
  event: string
  message: string
  shopId?: string | null
  actorId?: string | null
  actorType?: ActorType | null
  entityType?: string | null
  entityId?: string | null
  status?: string | null
  errorCode?: string | number | null
  metadata?: Record<string, unknown>
}

const LEVEL_TO_LOG: Record<OpsLevel, LogLevel> = {
  INFO: 'info',
  WARN: 'warn',
  ERROR: 'error',
}

const MAX_METADATA_CHARS = 4000

function safeMetadata(metadata?: Record<string, unknown>): object | undefined {
  if (!metadata) return undefined
  const redacted = redact(metadata) as object
  // Guard against accidentally huge blobs bloating the ops table.
  const json = JSON.stringify(redacted)
  if (json.length > MAX_METADATA_CHARS) {
    return { truncated: true, note: 'metadata omitted (too large)' }
  }
  return redacted
}

export async function recordOpsEvent(input: OpsEventInput): Promise<void> {
  const level: OpsLevel = input.level ?? 'INFO'
  const errorCode = input.errorCode == null ? null : String(input.errorCode)

  // Always emit the structured log first — even if the DB write fails, the
  // signal survives in the platform log drain.
  logger[LEVEL_TO_LOG[level]](input.message, {
    event: input.event,
    shopId: input.shopId ?? undefined,
    actorId: input.actorId ?? undefined,
    actorType: input.actorType ?? undefined,
    entityType: input.entityType ?? undefined,
    entityId: input.entityId ?? undefined,
    status: input.status ?? undefined,
    errorCode: errorCode ?? undefined,
    ...(input.metadata ? { metadata: input.metadata } : {}),
  })

  try {
    await prisma.opsEvent.create({
      data: {
        level,
        event: input.event,
        message: input.message,
        shopId: input.shopId ?? null,
        actorId: input.actorId ?? null,
        actorType: input.actorType ?? null,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        status: input.status ?? null,
        errorCode,
        metadata: safeMetadata(input.metadata) as object | undefined,
      },
    })
  } catch (err) {
    // Never let ops logging break the business flow.
    logger.error('recordOpsEvent failed to persist', { event: 'ops.persist_failed', error: err })
  }
}
