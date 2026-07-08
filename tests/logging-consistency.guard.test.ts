import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

function listRouteFiles(dir: string): string[] {
  const abs = resolve(process.cwd(), dir)
  const out: string[] = []
  for (const entry of readdirSync(abs)) {
    const full = join(abs, entry)
    const rel = join(dir, entry)
    if (statSync(full).isDirectory()) {
      out.push(...listRouteFiles(rel))
    } else if (entry === 'route.ts') {
      out.push(rel)
    }
  }
  return out
}

/**
 * Production-readiness follow-up: every API route's catch-block error log
 * now goes through the structured `logger` (redacts secrets/tokens/signed
 * URLs, consistent JSON shape in production) instead of raw `console.error`,
 * which was inconsistent across ~20+ routes and untracked by any log drain
 * parsing. `console.error`/`console.log`/`console.warn` remain acceptable
 * ONLY in non-route utility scripts (none of those live under
 * src/app/api/**), not in any route handler.
 */
describe('every API route uses the structured logger, never raw console.error', () => {
  const routeFiles = listRouteFiles('src/app/api')

  it('found a non-trivial number of route.ts files to check (sanity check on the scan itself)', () => {
    expect(routeFiles.length).toBeGreaterThan(30)
  })

  it('no route.ts file calls console.error/console.warn/console.log', () => {
    const offenders: string[] = []
    for (const file of routeFiles) {
      const source = read(file)
      if (/console\.(error|warn|log)\(/.test(source)) {
        offenders.push(file)
      }
    }
    expect(offenders).toEqual([])
  })

  it('every route.ts that has a try/catch error handler imports a structured logging mechanism (the shared logger, or the ops-events recorder for cron/infra routes)', () => {
    const offenders: string[] = []
    for (const file of routeFiles) {
      const source = read(file)
      const hasCatchBlock = /\}\s*catch\s*\(/.test(source)
      const importsLogger = source.includes("from '@/lib/logger'") || source.includes("from '@/lib/server/ops-events'")
      if (hasCatchBlock && !importsLogger) {
        offenders.push(file)
      }
    }
    expect(offenders).toEqual([])
  })
})
