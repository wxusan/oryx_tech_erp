import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const route = readFileSync('src/app/api/export/[entity]/route.ts', 'utf8')
const center = readFileSync('src/app/(shop)/shop/eksport/export-center.tsx', 'utf8')

describe('bounded financial recovery exports', () => {
  it('exposes each append-only ledger behind its parent export permission', () => {
    for (const [entity, permission] of [
      ['sale-payments', 'EXPORT_SALES'],
      ['nasiya-schedules', 'EXPORT_NASIYA'],
      ['nasiya-payments', 'EXPORT_NASIYA'],
      ['nasiya-payment-allocations', 'EXPORT_NASIYA'],
      ['supplier-payable-payments', 'EXPORT_OLIB'],
    ] as const) {
      expect(route).toContain(`'${entity}': '${permission}'`)
      expect(center).toContain(`entity: '${entity}', permission: '${permission}'`)
    }
  })

  it('uses one take+1 bounded query per ledger without exact counts', () => {
    expect(route).toContain('fetchRows(EXPORT_ROW_LIMIT + 1)')
    expect(route).toContain('rows.length > EXPORT_ROW_LIMIT')
    expect(route.split('fetchBoundedLedgerRows(entity').length - 1).toBe(5)

    for (const model of [
      'salePayment',
      'nasiyaSchedule',
      'nasiyaPayment',
      'nasiyaPaymentAllocation',
      'supplierPayablePayment',
    ]) {
      expect(route).toContain(`prisma.${model}.findMany({`)
    }
  })

  it('exports immutable identifiers, native/input/UZS facts, quote evidence, and schema version', () => {
    expect(route).toContain("'X-Oryx-Export-Schema-Version': EXPORT_SCHEMA_VERSION")
    expect(route).toContain("'schemaVersion'")
    expect(route).toContain("'amountUzsSnapshot'")
    expect(route).toContain("'paymentInputAmount'")
    expect(route).toContain("'appliedAmountInContractCurrency'")
    expect(route).toContain("'paymentExchangeRateSource'")
    expect(route).toContain("'paymentExchangeRateEffectiveAt'")
    expect(route).toContain("'paymentExchangeRateFetchedAt'")
    expect(route).toContain("'evidenceVersion'")
    expect(route).toContain("'evidenceStatus'")
    expect(route).toContain("'contractPrincipalAmount'")
    expect(route).toContain("'contractInterestAmount'")
  })

  it('includes audit before/after JSON and retains staff financial redaction', () => {
    expect(route).toContain('oldValue: true')
    expect(route).toContain('newValue: true')
    expect(route).toContain('redactShopStaffLogValue(log.oldValue)')
    expect(route).toContain('redactShopStaffLogValue(log.newValue)')
    expect(route).toContain("'oldValueJson'")
    expect(route).toContain("'newValueJson'")
  })

  it('keeps recovery ledgers and their profit allocations owner-only', () => {
    expect(route).toContain('const OWNER_ONLY_LEDGER_EXPORTS = new Set([')
    expect(route).toContain('isShopStaff && OWNER_ONLY_LEDGER_EXPORTS.has(entity)')
    expect(center).toContain("memberKind === 'SHOP_OWNER'")
    expect(center.split('ownerOnly: true').length - 1).toBe(5)
  })
})
