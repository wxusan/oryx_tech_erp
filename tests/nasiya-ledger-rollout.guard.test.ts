import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function read(rel: string) {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

describe('Nasiya ledger rollout safety', () => {
  const stageOne = read('prisma/migrations/202607160001_nasiya_payment_rate_source/migration.sql')
  const stageTwo = read('prisma/migrations/202607160002_nasiya_ledger_enforcement/migration.sql')
  const repair = read('scripts/reconcile-nasiya-ledgers.mjs')
  const preflight = read('scripts/production-release-preflight.mjs')

  it('adds a complete payment-time FX receipt shape before enforcement', () => {
    for (const column of [
      'paymentExchangeRateSource',
      'paymentExchangeRateEffectiveAt',
      'paymentExchangeRateFetchedAt',
    ]) {
      expect(stageOne).toContain(`ADD COLUMN IF NOT EXISTS "${column}"`)
    }
    expect(stageOne).toContain("'CBU', 'MANUAL', 'RECORDED_FROZEN', 'UNAVAILABLE_SAME_CURRENCY'")
    expect(stageOne).toContain('NOT VALID')
    expect(stageOne).not.toContain('DROP COLUMN')
  })

  it('keeps historical repair read-only by default and requires human recovery confirmation to apply', () => {
    expect(repair).toContain("const apply = process.argv.includes('--apply')")
    expect(repair).toContain("mode: apply ? 'apply' : 'dry-run'")
    expect(repair).toContain('--apply requires --actor-id and --actor-type=SUPER_ADMIN|SHOP_ADMIN')
    expect(repair).toContain('ORYX_NASIYA_LEDGER_REPAIR_PITR_CONFIRMED')
    expect(repair).toContain('--backup-reference')
    expect(repair).toContain('if (!apply) continue')
    expect(repair).toContain("'RECONCILE_NASIYA_LEDGER_CACHE'")
    expect(repair).toContain('logHasShopId')
    expect(repair).toContain("column_name = 'shopId'")
    expect(repair).toContain('SAVEPOINT nasiya_ledger_audit')
    expect(repair).toContain("error?.code !== '42703'")
    expect(repair).not.toContain('DELETE FROM "NasiyaPayment"')
    expect(repair).not.toContain('UPDATE "NasiyaSchedule"')
  })

  it('makes database enforcement self-gating and deferred until an entire mutation commits', () => {
    expect(stageTwo).toContain('Nasiya ledger enforcement is blocked')
    expect(stageTwo).toContain('complete allocation history disagrees with schedules')
    expect(stageTwo).toContain('VALIDATE CONSTRAINT "NasiyaPayment_input_snapshot_check"')
    expect(stageTwo).toContain('CREATE CONSTRAINT TRIGGER "Nasiya_parent_schedule_ledger_reconcile"')
    expect(stageTwo).toContain('CREATE CONSTRAINT TRIGGER "NasiyaSchedule_parent_schedule_ledger_reconcile"')
    expect(stageTwo).toContain('DEFERRABLE INITIALLY DEFERRED')
    expect(stageTwo).toContain('parent paid/remaining cache differs from schedules')
  })

  it('keeps release preflight blocking for ledger and FX evidence mismatches without logging records', () => {
    expect(preflight).toContain('nasiya_parent_schedule_ledger_mismatches')
    expect(preflight).toContain('complete_nasiya_schedule_allocation_mismatches')
    expect(preflight).toContain('nasiya_payment_stage_one_validation_issues')
    expect(preflight).toContain('nasiya_payment_fx_snapshot_issues')
    expect(preflight).toContain('Production release blocked by one or more integrity diagnostics')
    expect(preflight).toContain('Never add entity')
  })
})
