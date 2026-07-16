import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const repair = readFileSync('scripts/run-guarded-nasiya-ledger-repair.mjs', 'utf8')
const restore = readFileSync('scripts/restore-nasiya-ledger-recovery-snapshot.mjs', 'utf8')
const build = readFileSync('scripts/vercel-build.mjs', 'utf8')
const workflow = readFileSync('.github/workflows/release-production.yml', 'utf8')

describe('guarded Nasiya ledger production repair', () => {
  it('is inert by default and limited to a reviewed guarded production release', () => {
    expect(repair).toContain("process.env.ORYX_NASIYA_LEDGER_REPAIR === '1'")
    expect(repair).toContain("process.env.VERCEL_ENV !== 'production'")
    expect(repair).toContain("process.env.ORYX_GUARDED_RELEASE !== 'github-actions'")
    expect(repair).toContain('audit.repairable === 0 && audit.ambiguous === 0')
    expect(repair).toContain('alreadyClean: true')
    expect(repair).toContain('exactly one repairable and no ambiguous ledgers')
    expect(repair).toContain("'--actor-type=SUPER_ADMIN'")
  })

  it('archives a verified snapshot before changing the parent cache and verifies the result', () => {
    expect(repair).toContain('create-nasiya-ledger-recovery-snapshot.mjs')
    expect(repair).toContain('snapshot.verified')
    expect(repair).toContain('supabase-storage://')
    expect(repair).toContain("contentType: 'image/png'")
    expect(repair).toContain('png-rgba-v1')
    expect(restore).toContain('readBigUInt64BE')
    expect(repair).toContain("'--apply'")
    expect(repair).toContain('remainingRepairable')
    expect(repair).not.toContain('UPDATE "NasiyaSchedule"')
    expect(repair).not.toContain('DELETE FROM "NasiyaPayment"')
  })

  it('runs only when the protected production workflow explicitly opts in', () => {
    expect(build).toContain("['scripts/run-guarded-nasiya-ledger-repair.mjs']")
    expect(workflow).toContain('repair_nasiya_ledger')
    expect(workflow).toContain('ORYX_NASIYA_LEDGER_REPAIR=1')
    expect(workflow).toContain('ORYX_NASIYA_LEDGER_REPAIR_APPROVER_LOGIN=wxusan')
  })
})
