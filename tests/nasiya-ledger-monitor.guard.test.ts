import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = readFileSync(resolve(process.cwd(), 'src/lib/server/nasiya-ledger-monitor.ts'), 'utf8')
const cron = readFileSync(resolve(process.cwd(), 'src/app/api/cron/reminders/route.ts'), 'utf8')

describe('Nasiya ledger production monitoring', () => {
  it('uses only count-level diagnostics and emits no entity or financial values', () => {
    expect(source).toContain('COUNT(*)::integer')
    expect(source).toContain("event: 'currency.nasiya_ledger_mismatch_detected'")
    expect(source).toContain("event: 'currency.nasiya_ledger_monitor_failed'")
    expect(source).toContain("metadata: { mode: 'count-only' }")
    expect(source).not.toMatch(/SELECT\s+n\.id\s*,\s*n\.[\"'](?:contract|remaining|paid)/i)
    expect(source).not.toContain('entityId:')
  })

  it('runs daily with the private cron but cannot fail reminder delivery', () => {
    expect(cron).toContain("import { monitorNasiyaLedgerIntegrity } from '@/lib/server/nasiya-ledger-monitor'")
    expect(cron).toContain('const nasiyaLedgerIntegrity = await monitorNasiyaLedgerIntegrity()')
    expect(cron).toContain('nasiyaLedgerIntegrity,')
  })
})
