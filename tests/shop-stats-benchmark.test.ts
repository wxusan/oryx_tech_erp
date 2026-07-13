import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const scriptPath = resolve(process.cwd(), 'scripts/benchmark-shop-stats.mjs')
const scriptSource = readFileSync(scriptPath, 'utf8')

function run(extraEnv: Record<string, string> = {}) {
  const env: Record<string, string | undefined> = { ...process.env }
  delete env.VERCEL
  delete env.VERCEL_ENV
  delete env.NODE_ENV
  delete env.PERF_DB_CONFIRM
  delete env.ALLOW_REMOTE_PERF_DATABASE
  Object.assign(env, extraEnv)

  try {
    const stdout = execFileSync(process.execPath, [scriptPath], {
      env: env as NodeJS.ProcessEnv,
      encoding: 'utf8',
    })
    return { code: 0, output: stdout }
  } catch (error) {
    const result = error as { status?: number; stdout?: string; stderr?: string }
    return {
      code: result.status ?? 1,
      output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
    }
  }
}

describe('shop stats benchmark safety policy', () => {
  it('requires an explicit destructive-fixture confirmation before connecting', () => {
    const result = run({
      TEST_DATABASE_URL: 'postgresql://benchmark@localhost:5432/oryx_stats_benchmark',
    })

    expect(result.code).toBe(1)
    expect(result.output).toContain('PERF_DB_CONFIRM=benchmark-disposable-obligation-database is required')
  })

  it('refuses production execution even with the confirmation', () => {
    const result = run({
      TEST_DATABASE_URL: 'postgresql://benchmark@localhost:5432/oryx_stats_benchmark',
      PERF_DB_CONFIRM: 'benchmark-disposable-obligation-database',
      VERCEL_ENV: 'production',
    })

    expect(result.code).toBe(1)
    expect(result.output).toContain('forbidden in production/Vercel environments')
  })

  it('refuses a database whose name is not explicitly marked disposable', () => {
    const result = run({
      TEST_DATABASE_URL: 'postgresql://benchmark@localhost:5432/oryx',
      PERF_DB_CONFIRM: 'benchmark-disposable-obligation-database',
    })

    expect(result.code).toBe(1)
    expect(result.output).toContain('is not marked test/perf/benchmark/disposable')
  })
})

describe('shop stats benchmark evidence contract', () => {
  it('keeps the realistic cardinality bounds and rollback-only transaction', () => {
    expect(scriptSource).toContain('const MIN_OBLIGATIONS = 50_000')
    expect(scriptSource).toContain('const MAX_OBLIGATIONS = 100_000')
    expect(scriptSource).toContain("await client.query('BEGIN')")
    expect(scriptSource).toContain("await client.query('ROLLBACK')")
  })

  it('records analyzed plans and asserts bounded hydration/index usage', () => {
    expect(scriptSource).toContain('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON, TIMING OFF, SUMMARY ON)')
    expect(scriptSource).toContain("requiredIndexes: ['NasiyaSchedule_shopId_effectiveDue_open_idx']")
    expect(scriptSource).toContain("requiredIndexes: ['NasiyaSchedule_pkey']")
    expect(scriptSource).toContain('expectedRows: 5')
  })

  it('benchmarks the same native-ledger and returned-contract predicates as production', () => {
    expect(scriptSource).not.toContain('AND s."remainingAmount" > 0')
    expect(scriptSource.match(/AND n\."returnedAt" IS NULL/g)).toHaveLength(2)
    expect(scriptSource.match(/AND s\."contractRemainingAmount" > 0/g)).toHaveLength(2)
  })
})
