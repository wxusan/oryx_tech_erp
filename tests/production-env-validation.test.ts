import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const script = resolve(process.cwd(), 'scripts/validate-production-env.mjs')

type TestEnvironment = Record<string, string | undefined>

const validEnvironment: TestEnvironment = {
  DATABASE_URL: 'postgresql://user:password@db.example.com:6543/postgres',
  DIRECT_URL: 'postgresql://user:password@db.example.com:5432/postgres',
  NEXTAUTH_SECRET: 'a-production-auth-secret-with-more-than-32-bytes',
  NEXTAUTH_URL: 'https://oryx.example.com',
  CRON_SECRET: 'cron-secret-long-enough',
  TELEGRAM_BOT_TOKEN: `123456:${'a'.repeat(32)}`,
  TELEGRAM_WEBHOOK_SECRET: 'telegram-webhook-secret',
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key-long-enough',
  SUPABASE_PRIVATE_BUCKET: 'oryx-private',
  DATABASE_POOL_MAX: '5',
}

function run(extra: TestEnvironment = {}, remove: string[] = []) {
  const env = { ...validEnvironment, ...extra }
  for (const key of remove) delete env[key]
  try {
    return {
      code: 0,
      output: execFileSync(process.execPath, [script], { env: env as NodeJS.ProcessEnv, encoding: 'utf8' }),
    }
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string }
    return {
      code: failure.status ?? 1,
      output: `${failure.stdout ?? ''}${failure.stderr ?? ''}`,
    }
  }
}

describe('production environment validation', () => {
  it('accepts a complete production configuration and reports the Redis fallback honestly', () => {
    const result = run()
    expect(result.code).toBe(0)
    expect(result.output).toContain('distributedRateLimit=local-fallback')
  })

  it('fails closed when core authentication or database configuration is missing', () => {
    const result = run({}, ['DIRECT_URL', 'NEXTAUTH_SECRET'])
    expect(result.code).toBe(1)
    expect(result.output).toContain('Missing DIRECT_URL')
    expect(result.output).toContain('Missing AUTH_SECRET or NEXTAUTH_SECRET')
  })

  it('accepts the Vercel Marketplace Redis pair but rejects partial credentials', () => {
    const configured = run({
      KV_REST_API_URL: 'https://marketplace.upstash.io',
      KV_REST_API_TOKEN: 'marketplace-token',
    })
    expect(configured.code).toBe(0)
    expect(configured.output).toContain('distributedRateLimit=configured')

    const partial = run({ KV_REST_API_URL: 'https://marketplace.upstash.io' })
    expect(partial.code).toBe(1)
    expect(partial.output).toContain('KV_REST_API_URL and KV_REST_API_TOKEN')
  })

  it('rejects malformed URLs and database pool sizes', () => {
    const result = run({ NEXTAUTH_URL: 'http://insecure.example.com', DATABASE_POOL_MAX: '100' })
    expect(result.code).toBe(1)
    expect(result.output).toContain('NEXTAUTH_URL must use https:')
    expect(result.output).toContain('DATABASE_POOL_MAX must be an integer from 1 to 20')
  })
})
