import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SHOP_PERMISSION_CATALOG } from '@/lib/access-control'
import { SHOP_STAFF_ROLE_PRESETS } from '@/lib/staff-role-presets'

function read(path: string) {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

describe('Nasiya early-settlement release contract', () => {
  const detail = read('src/app/(shop)/shop/nasiyalar/[id]/page.tsx')
  const list = read('src/app/(shop)/shop/nasiyalar/nasiyalar-client.tsx')
  const modal = read('src/components/shop/nasiya-settlement-modal.tsx')
  const route = read('src/app/api/nasiya/[id]/settlement/route.ts')
  const migration = read('prisma/migrations/202607220002_nasiya_early_settlement/migration.sql')

  it('keeps the action on the Nasiya detail page and off every list card', () => {
    expect(detail).toContain('Nasiyani yopish')
    expect(detail).toContain('<NasiyaSettlementModal')
    expect(detail).toContain('nasiya.settlementQuotes')
    expect(list).not.toContain('Nasiyani yopish')
    expect(list).not.toContain('NasiyaSettlementModal')
    expect(list).not.toContain('/settlement')
  })

  it('uses the approved short labels and explains the accounting effect before confirmation', () => {
    expect(modal).toContain('Foydasi bilan yopish')
    expect(modal).toContain('Qolgan qarz va foyda to‘liq olinadi.')
    expect(modal).toContain('Foydani kechib yopish')
    expect(modal).toContain('Qolgan qarz olinadi, kelgusi nasiya foydasi kechiladi.')
    expect(modal).toContain('Oldingi to‘lovlar o‘zgarmaydi.')
    expect(modal).toContain('Yopilgandan keyin')
    expect(modal).toContain('aria-busy={pending || refreshing}')
    expect(modal).toContain('pendingLabel="Nasiya yopilmoqda…"')
    expect(modal).toContain('if (!canSubmit || pending) return')
  })

  it('requires the ordinary collection grant and a separate live waiver grant', () => {
    const waiverPermission = SHOP_PERMISSION_CATALOG.find(({ code }) => code === 'NASIYA_PROFIT_WAIVE')
    expect(waiverPermission).toMatchObject({
      risk: 'DESTRUCTIVE',
      featureCode: 'NASIYA',
      staffManagerDelegable: false,
      legacyOperational: false,
    })
    expect(SHOP_STAFF_ROLE_PRESETS.flatMap(({ permissionCodes }) => permissionCodes))
      .not.toContain('NASIYA_PROFIT_WAIVE')
    expect(route).toContain("requireShopPermissionAndFeature('NASIYA_PAYMENT_RECEIVE', 'NASIYA')")
    expect(route).toContain("principalHasPermission(guarded.principal, 'NASIYA_PROFIT_WAIVE')")
    expect(route).toContain('getLiveShopPrincipalForMutation')
    expect(route).toContain("principalHasPermission(livePrincipal, 'NASIYA_PROFIT_WAIVE')")
    expect(migration).toContain('-- Deliberately not backfilled to staff presets.')
  })

  it('serializes the money mutation with tenant locks, stale-quote protection, bounds, and idempotency', () => {
    expect(route).toContain('WHERE "id" = ${nasiyaId} AND "shopId" = ${shopId}')
    expect(route).toContain('FOR UPDATE')
    expect(route).toContain('Prisma.TransactionIsolationLevel.Serializable')
    expect(route).toContain('shopId_idempotencyKey')
    expect(route).toContain('commandHash')
    expect(route).toContain('expectedRemainingMinorUnits')
    expect(route).toContain('expectedCashMinorUnits')
    expect(route).toContain('expectedWaivedMinorUnits')
    expect(route).toContain('MAX_SETTLEMENT_SCHEDULES + 1')
    expect(route).toContain('MAX_LEDGER_ALLOCATIONS + 1')
    expect(route).toContain('MAX_LEDGER_ALLOCATIONS + MAX_SETTLEMENT_SCHEDULES + 1')
    expect(route).toContain('isRetryableTransactionError')
  })

  it('records cash and waiver separately without returning the device or touching supplier debt', () => {
    expect(route).toContain('tx.nasiyaPayment.create')
    expect(route).toContain('tx.nasiyaSettlement.create')
    expect(route).toContain('tx.nasiyaSettlementAllocation.createMany')
    expect(route).toContain("status: 'COMPLETED'")
    expect(route).toContain('contractRemainingAmount: 0')
    expect(route).not.toContain('tx.device.update')
    expect(route).not.toContain('tx.supplierPayable')
    expect(route).not.toContain("status: 'IN_STOCK'")
  })

  it('enforces fulfilled-debt identities and immutable settlement evidence in PostgreSQL', () => {
    expect(migration).toContain('"contractPaidAmount" + "contractInterestWaivedAmount" + "contractRemainingAmount" = "contractFinalAmount"')
    expect(migration).toContain('"contractRemainingBefore" = "contractCashReceivedAmount" + "contractInterestWaivedAmount"')
    expect(migration).toContain('NasiyaSettlement_immutable')
    expect(migration).toContain('NasiyaSettlementAllocation_immutable')
    expect(migration).toContain('DEFERRABLE INITIALLY DEFERRED')
    expect(migration).toContain('validate_nasiya_settlement_ledger')
    expect(migration).toContain('allocation_cash_uzs <> settlement_row."cashReceivedAmountUzs"')
    expect(migration).toContain('allocation_waived_uzs <> settlement_row."interestWaivedAmountUzs"')
    expect(migration).toContain('trunc("interestWaivedAmountUzs") = "interestWaivedAmountUzs"')
    expect(migration).toContain('NasiyaSettlement_ledger_reconcile')
    expect(migration).toContain('NasiyaSettlementAllocation_ledger_reconcile')
    expect(migration).toContain('Nasiya_settlement_ledger_reconcile')
    expect(migration).toContain('NasiyaSchedule_settlement_ledger_reconcile')
    expect(migration).toContain("'FULL_WITH_PROFIT' AND \"contractInterestWaivedAmount\" = 0")
    expect(migration).toContain("'WAIVE_REMAINING_PROFIT' AND \"contractInterestWaivedAmount\" > 0")
  })

  it('separates settlement-day UZS evidence from the creation-rate compatibility ledger', () => {
    expect(route).toContain("const waiverUzsMoney = convertMoneyDto(quote.interestToWaive, 'UZS', reportingFxQuote)")
    expect(route).toContain("nasiya.contractCurrency === 'USD' ? creationFallbackQuote : null")
    expect(route).toContain('legacyWaiverUzsAllocations')
    expect(route).toContain('interestWaivedAmountUzs: waiverUzs')
    expect(route).toContain('interestWaivedAmount: legacyParentWaivedAfter')
  })

  it('cancels actionable reminders and emits one settlement-specific notification and audit event', () => {
    expect(route).toContain("type: { in: ['REMINDER', 'OVERDUE', 'EARLY_REMINDER'] }")
    expect(route).toContain("status: { in: ['PENDING', 'PROCESSING', 'FAILED'] }")
    expect(route).toContain("status: 'CANCELLED'")
    expect(route).toContain("type: 'NASIYA_COMPLETED'")
    expect(route).toContain('NASIYA_SETTLEMENT:${settlement.id}:${recipient.id}')
    expect(route).toContain("'NASIYA_SETTLED_FULL_WITH_PROFIT'")
    expect(route).toContain("'NASIYA_SETTLED_PROFIT_WAIVED'")
  })

  it('propagates waived profit through exports, reports, trust, customer history, and cache invalidation', () => {
    const exportRoute = read('src/app/api/export/[entity]/route.ts')
    const rangeReport = read('src/lib/server/shop-report-range.ts')
    const stats = read('src/lib/server/shop-stats-queries.ts')
    const customerProfile = read('src/lib/server/customer-profile.ts')
    const trust = read('src/lib/nasiya-customer-trust.ts')
    const score = read('src/lib/nasiya-payment-score.ts')
    const cache = read('src/lib/server/cache-tags.ts')

    expect(exportRoute).toContain('contractInterestWaivedAmount')
    expect(exportRoute).toContain('settlementMode')
    expect(rangeReport).toContain('waivedNasiyaProfit')
    expect(stats).toContain('settlement_waiver AS')
    expect(stats).toContain('waivedNasiyaProfitUzs')
    expect(customerProfile).toContain('waivedNasiyaProfit')
    expect(trust).toContain('settledWithWaiverCount')
    expect(score).toContain('interestWaivedAmount?:')
    expect(score).toContain('Number(schedule.interestWaivedAmount ?? 0)')
    expect(cache).toContain('invalidateShopNasiyaSettlementMutation')
  })
})
