import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Behavioural test for scripts/check-db-safety.mjs. Runs the real guard as a
// subprocess in a clean cwd (no .env files) so only the injected env matters.

const script = join(process.cwd(), 'scripts', 'check-db-safety.mjs')
const cleanCwd = mkdtempSync(join(tmpdir(), 'db-safety-'))

function run(args: string[], extraEnv: Record<string, string> = {}) {
  const env: Record<string, string | undefined> = { ...process.env }
  // Strip inherited prod markers FIRST, then let extraEnv opt back in.
  delete env.VERCEL
  delete env.VERCEL_ENV
  delete env.NODE_ENV
  Object.assign(env, extraEnv)
  try {
    const stdout = execFileSync('node', [script, ...args], {
      cwd: cleanCwd,
      env: env as NodeJS.ProcessEnv,
      encoding: 'utf8',
    })
    return { code: 0, stdout }
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string }
    return { code: e.status ?? 1, stdout: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}

const LOCAL = 'postgresql://u:p@localhost:5432/db'
const REMOTE = 'postgresql://u:p@db.abc.supabase.com:5432/postgres'

describe('db safety guard', () => {
  it('blocks `db push` by default even for a local DB', () => {
    const r = run(['push'], { DIRECT_URL: LOCAL, DATABASE_URL: LOCAL })
    expect(r.code).toBe(1)
    expect(r.stdout).toContain('BLOCKED')
  })

  it('allows push --allow-local against a localhost DB', () => {
    const r = run(['push', '--allow-local'], { DIRECT_URL: LOCAL, DATABASE_URL: LOCAL })
    expect(r.code).toBe(0)
    expect(r.stdout).toContain('OK')
  })

  it('blocks push --allow-local against a remote/prod DB', () => {
    const r = run(['push', '--allow-local'], { DIRECT_URL: REMOTE, DATABASE_URL: REMOTE })
    expect(r.code).toBe(1)
    expect(r.stdout).toContain('BLOCKED')
  })

  it('blocks migrate-dev against a remote/prod DB', () => {
    const r = run(['migrate-dev'], { DIRECT_URL: REMOTE, DATABASE_URL: REMOTE })
    expect(r.code).toBe(1)
  })

  it('blocks migrate-dev when a production env is detected', () => {
    const r = run(['migrate-dev'], { DIRECT_URL: LOCAL, DATABASE_URL: LOCAL, VERCEL: '1' })
    expect(r.code).toBe(1)
  })

  it('allows migrate-dev against a local DB in dev', () => {
    const r = run(['migrate-dev'], { DIRECT_URL: LOCAL, DATABASE_URL: LOCAL })
    expect(r.code).toBe(0)
  })
})
