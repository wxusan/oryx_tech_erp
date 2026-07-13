import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Source-level guards for the ops/observability wiring. Behavioural DB coverage
// also runs in tests/integration; these fail quickly if wiring is reverted.

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

function readFlat(rel: string): string {
  return read(rel).replace(/\s+/g, ' ')
}

describe('cron reminders observability', () => {
  const src = readFlat('src/app/api/cron/reminders/route.ts')

  it('records start, completed and failed ops events', () => {
    expect(src).toContain("event: 'cron.reminders.started'")
    expect(src).toContain("event: 'cron.reminders.completed'")
    expect(src).toContain("event: 'cron.reminders.failed'")
  })

  it('wraps the body in a try/catch so a throw is recorded, not swallowed', () => {
    expect(src).toContain('} catch (error) {')
    expect(src).toContain('durationMs')
  })
})

describe('notification observability', () => {
  const src = readFlat('src/lib/notification-service.ts')

  it('records an ERROR ops event when a notification is cancelled after retries', () => {
    expect(src).toContain("event: 'notification.cancelled'")
    expect(src).toContain('recordOpsEvent')
  })

  it('returns a full run summary (attempted/sent/failed/cancelled/durationMs)', () => {
    expect(src).toContain('attempted')
    expect(src).toContain('cancelled')
    expect(src).toContain('durationMs')
  })

  it('keeps the retry cap and does not re-throw (never blocks the caller)', () => {
    expect(src).toContain('MAX_NOTIFICATION_ATTEMPTS')
    expect(src).not.toContain('throw error')
    expect(src).not.toContain('throw innerError')
  })
})

describe('telegram send route logging', () => {
  const src = readFlat('src/app/api/telegram/send/route.ts')
  it('logs the drain result and records an ops event on crash', () => {
    expect(src).toContain("event: 'telegram.send'")
    expect(src).toContain("event: 'telegram.send_failed'")
    expect(src).not.toContain('console.error')
  })
})

describe('telegram webhook logging', () => {
  const src = readFlat('src/app/api/telegram/webhook/route.ts')
  it('records webhook command failures as ops events instead of console.error', () => {
    expect(src).toContain("event: 'telegram.webhook_error'")
    expect(src).not.toContain('console.error')
  })
})

describe('logger redaction guard', () => {
  const src = readFlat('src/lib/logger.ts')
  it('lists the required sensitive key parts', () => {
    for (const part of ['password', 'token', 'secret', 'authorization', 'cookie', 'database_url', 'direct_url']) {
      expect(src.toLowerCase()).toContain(part)
    }
  })
  it('only prints stack traces outside production', () => {
    expect(src).toContain("process.env.NODE_ENV !== 'production'")
  })
})

describe('health endpoint safety', () => {
  const src = readFlat('src/app/api/health/route.ts')
  it('exposes only ok/timestamp/commit/database and probes the DB', () => {
    expect(src).toContain('SELECT 1')
    expect(src).toContain('initializeRequestAuditContext(request.headers)')
    expect(src).toContain('timestamp')
    expect(src).toContain('database')
    // Must NOT leak queue internals or shop data from the public endpoint.
    expect(src).not.toContain('notificationCounts')
    expect(src).not.toContain('shopId')
  })
})

describe('admin ops endpoint access control', () => {
  const raw = read('src/app/api/admin/ops/route.ts')
  it('requires super admin', () => {
    expect(raw).toContain('requireSuperAdmin()')
  })
  it('surfaces notification backlog/failure warnings', () => {
    expect(raw).toContain('notificationWarnings')
    expect(raw).toContain('notificationCounts.PENDING > 100')
    expect(raw).toContain('notificationCounts.FAILED > 0')
    expect(raw).toContain('notificationCounts.CANCELLED > 0')
    expect(raw).toContain('oldestActionableNotification')
    expect(raw).toContain('oldestActionableAgeSeconds > 15 * 60')
    expect(raw).toContain('queueHealth')
  })
  it('omits notification message bodies (customer PII) from the payload', () => {
    // Scope to the failed-notification query's select block — OpsEvent.message
    // (a system message, no PII) is fine, but Notification.message is not.
    const match = raw.match(/notification\.findMany\(\{[\s\S]*?select:\s*\{([\s\S]*?)\}/)
    expect(match, 'notification.findMany select not found').not.toBeNull()
    expect(match![1]).not.toContain('message')
    expect(match![1]).toContain('lastError')
  })
})

describe('migration safety wiring', () => {
  const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> }

  it('db:push goes through the safety guard', () => {
    expect(pkg.scripts['db:push']).toContain('check-db-safety.mjs push')
    expect(pkg.scripts['db:push']).not.toContain('prisma db push')
  })

  it('db:push:local requires --allow-local before pushing', () => {
    expect(pkg.scripts['db:push:local']).toContain('--allow-local')
    expect(pkg.scripts['db:push:local']).toContain('prisma db push')
  })

  it('migrate:deploy stays explicit', () => {
    expect(pkg.scripts['prisma:migrate:deploy']).toBe('prisma migrate deploy')
  })

  it('build and prebuild NEVER run migrations', () => {
    for (const key of ['build', 'prebuild', 'postinstall']) {
      const script = pkg.scripts[key] ?? ''
      expect(script).not.toContain('migrate')
      expect(script).not.toContain('db push')
    }
    expect(pkg.scripts.build).toBe('next build')
    expect(pkg.scripts.prebuild).toBe('prisma generate')
  })
})
