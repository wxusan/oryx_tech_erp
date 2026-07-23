import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  'prisma/migrations/202607230003_usd_uzs_evidence_integrity/migration.sql',
  'utf8',
)

describe('USD/UZS expand-migration release safety', () => {
  it('does not wrap online index builds in one migration-wide transaction', () => {
    expect(migration).not.toMatch(/^\s*BEGIN;\s*$/m)
    expect(migration).not.toMatch(/^\s*COMMIT;\s*$/m)
  })

  it('builds indexes on populated tables concurrently', () => {
    expect(migration).toContain(
      'CREATE UNIQUE INDEX CONCURRENTLY "Nasiya_shopId_importIdempotencyKey_key"',
    )
    expect(migration).toContain(
      'CREATE INDEX CONCURRENTLY "CurrencyRate_source_providerReference_idx"',
    )
    expect(migration).toContain(
      'CREATE UNIQUE INDEX CONCURRENTLY "CurrencyRate_manual_providerReference_key"',
    )
    expect(migration).toContain(
      'CREATE UNIQUE INDEX CONCURRENTLY "SupplierPayable_deviceId_v2_key"',
    )
  })

  it('adds populated-table evidence checks as NOT VALID before explicit validation', () => {
    for (const constraint of [
      'CurrencyRate_evidence_check',
      'Device_purchase_evidence_check',
      'Sale_creation_evidence_check',
      'Nasiya_creation_evidence_check',
      'SupplierPayable_creation_evidence_check',
      'ShopPayment_evidence_check',
      'SalePayment_evidence_check',
      'NasiyaPayment_evidence_check',
      'SupplierPayablePayment_evidence_check',
    ]) {
      const start = migration.indexOf(`ADD CONSTRAINT "${constraint}"`)
      const end = migration.indexOf(';', start)
      expect(start).toBeGreaterThan(-1)
      expect(migration.slice(start, end)).toContain('NOT VALID')
      expect(migration).toContain(`VALIDATE CONSTRAINT "${constraint}"`)
    }
  })
})
