/**
 * Small internal structured logger for Oryx ERP.
 *
 * - Server-side only, no paid service, no dependency.
 * - Production: one-line JSON per event (parseable by Vercel / any log drain).
 * - Development: readable `LEVEL [event] message { context }` lines.
 * - Redacts secret-ish keys and long signed URLs so tokens / cookies / DB URLs
 *   never reach the log sink.
 *
 * This is for OPERATIONAL logging (health, jobs, failures). User/admin business
 * actions still go to the `Log` table. System failures worth persisting also go
 * to `OpsEvent` via `recordOpsEvent` (see server/ops-events.ts).
 */

export type LogLevel = 'info' | 'warn' | 'error'

export interface LogContext {
  event?: string
  route?: string
  shopId?: string | null
  actorId?: string | null
  actorType?: string | null
  entityType?: string | null
  entityId?: string | null
  requestId?: string | null
  durationMs?: number
  attempt?: number
  status?: string
  errorCode?: string | number
  [key: string]: unknown
}

const REDACTED = '[redacted]'

// Substrings that mark a key as sensitive (case-insensitive).
const SENSITIVE_KEY_PARTS = [
  'password',
  'token',
  'secret',
  'authorization',
  'cookie',
  'passwordhash',
  'apikey',
  'api_key',
  'servicerole',
  'service_role',
  'connectionstring',
  'databaseurl',
  'database_url',
  'directurl',
  'direct_url',
]

function isSensitiveKey(key: string): boolean {
  const k = key.toLowerCase()
  return SENSITIVE_KEY_PARTS.some((part) => k.includes(part))
}

/**
 * A single string value can still leak a secret even under a harmless key:
 *   - postgres/postgresql connection strings
 *   - Telegram bot tokens (digits:base64ish) that appear in grammy error URLs
 *   - long signed storage URLs (private passport / device photos)
 */
function redactStringValue(value: string): string {
  if (/postgres(?:ql)?:\/\//i.test(value)) return REDACTED
  if (/\bbot\d{6,}:[A-Za-z0-9_-]{20,}/.test(value)) return value.replace(/\bbot\d{6,}:[A-Za-z0-9_-]{20,}/g, `bot${REDACTED}`)
  if (/\b\d{6,}:[A-Za-z0-9_-]{30,}\b/.test(value)) return value.replace(/\b\d{6,}:[A-Za-z0-9_-]{30,}\b/g, REDACTED)
  // Signed storage URLs carry a token query param — drop the query entirely.
  if (/^https?:\/\/\S+[?&](token|X-Amz|signature|se=)/i.test(value)) {
    return value.replace(/[?].*$/, '?' + REDACTED)
  }
  return value
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[depth-limit]'
  if (value == null) return value
  if (typeof value === 'string') return redactStringValue(value)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (value instanceof Error) return serializeError(value)
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1))
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = isSensitiveKey(key) ? REDACTED : redact(val, depth + 1)
    }
    return out
  }
  // Functions, symbols, bigint, etc.
  return typeof value
}

export function serializeError(err: unknown): Record<string, unknown> {
  if (!(err instanceof Error)) {
    return { message: String(err) }
  }
  const out: Record<string, unknown> = {
    name: err.name,
    message: redactStringValue(err.message),
  }
  // grammy GrammyError carries a numeric Telegram error_code + description.
  const anyErr = err as unknown as Record<string, unknown>
  if (typeof anyErr.error_code === 'number') out.errorCode = anyErr.error_code
  if (typeof anyErr.description === 'string') out.description = redactStringValue(anyErr.description)
  // Stack only outside production (may contain paths / inlined values).
  if (process.env.NODE_ENV !== 'production' && err.stack) {
    out.stack = redactStringValue(err.stack)
  }
  if (err.cause) out.cause = redact(err.cause, 4)
  return out
}

function write(level: LogLevel, message: string, context: LogContext = {}) {
  const safeContext = redact(context) as Record<string, unknown>
  const isProd = process.env.NODE_ENV === 'production'
  const method = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log

  if (isProd) {
    method(
      JSON.stringify({
        level,
        message,
        time: new Date().toISOString(),
        ...safeContext,
      }),
    )
    return
  }

  const event = context.event ? ` [${context.event}]` : ''
  const hasContext = Object.keys(safeContext).length > 0
  method(`${level.toUpperCase()}${event} ${message}`, hasContext ? safeContext : '')
}

export const logger = {
  info: (message: string, context?: LogContext) => write('info', message, context),
  warn: (message: string, context?: LogContext) => write('warn', message, context),
  error: (message: string, context?: LogContext & { error?: unknown }) => {
    const { error, ...rest } = context ?? {}
    write('error', message, error === undefined ? rest : { ...rest, error: serializeError(error) })
  },
}
