import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

const schema = read('prisma/schema.prisma')
const migration = read(
  'prisma/migrations/202607230003_usd_uzs_evidence_integrity/migration.sql',
)
const preflight = read('scripts/production-release-preflight.mjs')

describe('USD/UZS financial evidence persistence contract', () => {
  it('models explicit evidence status and immutable purchase receipts', () => {
    expect(schema).toContain('enum FinancialEvidenceStatus')
    for (const status of [
      'LEGACY_UNKNOWN',
      'CAPTURED',
      'VERIFIED_RECONSTRUCTION',
      'PARTIAL',
      'UNRECONSTRUCTABLE',
    ]) {
      expect(schema).toContain(`  ${status}`)
    }

    expect(schema).toContain('model DevicePurchaseReceipt')
    expect(schema).toContain('purchaseReceipt     DevicePurchaseReceipt?')
    expect(schema).toContain('devicePurchaseReceipts      DevicePurchaseReceipt[]')
    expect(schema).toContain('@@unique([shopId, idempotencyKey])')
    expect(schema).toContain('evidenceVersion         Int                     @default(2)')
    expect(schema).toContain(
      'evidenceStatus          FinancialEvidenceStatus @default(CAPTURED)',
    )
  })

  it('stores governed rate provenance and tenant-scoped import replay identity', () => {
    expect(schema).toContain('providerReference String?')
    expect(schema).toContain('recordedById      String?')
    expect(schema).toContain('recordedByType    ActorType?')
    expect(schema).toContain('@@index([source, providerReference])')
    expect(migration).toContain(
      'CREATE INDEX CONCURRENTLY "CurrencyRate_source_providerReference_idx"',
    )
    expect(migration).toContain('CurrencyRate_manual_providerReference_key')
    expect(migration).toContain(`WHERE "source" = 'MANUAL' AND "providerReference" IS NOT NULL`)
    expect(schema).toContain('importIdempotencyKey    String?')
    expect(schema).toContain('importCommandHash       String?')
    expect(schema).toContain('@@unique([shopId, importIdempotencyKey])')
    expect(migration).toContain('Nasiya_shopId_importIdempotencyKey_key')
    expect(migration).toContain('Nasiya_shopId_creationIdempotencyKey_key')
    expect(schema).not.toMatch(/\bsource\s+String\s+@default\("CBU"\)/)
  })

  it('quarantines a positive sale refund when a legacy receipt has no proven native amount', () => {
    const route = read('src/app/api/devices/[id]/return/route.ts')

    expect(route).toContain('contractRefundAmount > 0')
    expect(route).toContain('sources.some((source) => source.appliedContractAmount === null)')
    expect(route).toContain('Pul qaytarishdan oldin moliyaviy yozuvni tekshiring')
  })

  it('preserves legacy rows and keeps the expand migration compatible with the live writer', () => {
    expect(migration).toContain(
      'ADD COLUMN "evidenceVersion" INTEGER NOT NULL DEFAULT 1',
    )
    expect(migration).toContain(
      'ADD COLUMN "evidenceStatus" "FinancialEvidenceStatus" NOT NULL DEFAULT \'LEGACY_UNKNOWN\'',
    )
    expect(migration).toContain(
      'Keep database defaults on the compatibility category during the expand',
    )
    expect(migration).not.toContain(
      'ALTER COLUMN "evidenceVersion" SET DEFAULT 2',
    )
    expect(migration).not.toContain(
      'ALTER COLUMN "evidenceStatus" SET DEFAULT \'CAPTURED\'',
    )
    expect(schema).toContain('evidenceVersion')
    expect(schema).toContain('@default(2)')
    expect(schema).toContain('@default(CAPTURED)')
    expect(migration).not.toMatch(
      /\bUPDATE\s+"(?:CurrencyRate|ShopPayment|Device|Sale|SalePayment|SupplierPayable|SupplierPayablePayment|Nasiya|NasiyaPayment)"/,
    )
    expect(migration).not.toMatch(/\bDELETE\s+FROM\b/)
    expect(migration).not.toMatch(/\bDROP\s+(?:TABLE|COLUMN)\b/)
  })

  it('validates complete evidence, append-only receipts, and source-native refund caps', () => {
    for (const constraint of [
      'CurrencyRate_evidence_check',
      'Device_purchase_evidence_check',
      'DevicePurchaseReceipt_evidence_check',
      'Sale_creation_evidence_check',
      'Nasiya_creation_evidence_check',
      'SupplierPayable_creation_evidence_check',
      'ShopPayment_evidence_check',
      'SalePayment_evidence_check',
      'NasiyaPayment_evidence_check',
      'SupplierPayablePayment_evidence_check',
      'Nasiya_import_command_pair_check',
    ]) {
      expect(migration).toContain(`"${constraint}"`)
    }

    for (const trigger of [
      'CurrencyRate_evidence_immutable',
      'ShopPayment_evidence_immutable',
      'Device_v2_purchase_evidence_immutable',
      'Device_acquisition_evidence_complete',
      'Sale_v2_creation_evidence_immutable',
      'SalePayment_evidence_immutable',
      'SalePayment_v2_components_immutable',
      'SalePayment_delete_immutable',
      'Nasiya_v2_creation_evidence_immutable',
      'NasiyaPayment_evidence_immutable',
      'SupplierPayable_v2_creation_evidence_immutable',
      'SupplierPayable_device_acquisition_evidence_complete',
      'DevicePurchaseReceipt_immutable',
      'SalePayment_validate_v2_evidence',
      'NasiyaPayment_validate_v2_evidence',
      'SupplierPayablePayment_validate_v2_evidence',
      'DevicePurchaseReceipt_validate_evidence',
    ]) {
      expect(migration).toContain(`"${trigger}"`)
    }

    expect(migration).toContain('IF OLD."evidenceVersion" = 2')
    expect(migration).toContain('version-2 device purchase evidence is immutable')
    expect(migration).toContain(
      'captured device requires exactly one acquisition evidence source',
    )
    expect(migration).toContain("ELSIF TG_OP = 'DELETE' THEN")
    expect(migration).toContain('target_device_id := OLD."deviceId"')
    expect(migration).toContain('DEFERRABLE INITIALLY DEFERRED')
    expect(migration).toContain(
      'CREATE FUNCTION "protect_sale_payment_v2_components"() RETURNS trigger',
    )
    expect(migration).toContain(
      "RAISE EXCEPTION 'version-2 sale payment components are immutable'",
    )
    expect(migration).toContain(
      'CREATE TRIGGER "SalePayment_delete_immutable"',
    )
    expect(migration).toContain(
      'BEFORE UPDATE OF\n    id, "saleId", "shopId", amount',
    )

    expect(migration).toContain(
      "RAISE EXCEPTION 'refund allocation exceeds source receipt native amount'",
    )
    expect(migration).toContain(
      'SUM(allocation."contractAmount") > payment."appliedAmountInContractCurrency"',
    )
    expect(migration).toContain('VALIDATE CONSTRAINT "CurrencyRate_evidence_check"')
  })

  it('blocks release when the migration, constraints, triggers, or reconciliation fail', () => {
    expect(preflight).toContain("'202607230003_usd_uzs_evidence_integrity'")
    for (const trigger of [
      'Device_v2_purchase_evidence_immutable',
      'Sale_v2_creation_evidence_immutable',
      'Nasiya_v2_creation_evidence_immutable',
      'SupplierPayable_v2_creation_evidence_immutable',
      'SalePayment_v2_components_immutable',
      'SalePayment_delete_immutable',
    ]) {
      expect(preflight).toContain(`'${trigger}'`)
    }
    for (const check of [
      'post_cutover_legacy_financial_writes',
      'financial_evidence_status_issues',
      'captured_fx_provenance_issues',
      'device_purchase_receipt_projection_issues',
      'device_acquisition_evidence_link_issues',
      'nasiya_import_command_evidence_issues',
      'financial_evidence_index_inventory_issues',
      'return_refund_source_native_cap_issues',
      'financial_evidence_constraint_inventory_issues',
      'financial_evidence_trigger_inventory_issues',
      'return_refund_source_cap_trigger_issues',
    ]) {
      expect(preflight).toContain(`name: '${check}'`)
    }
    for (const index of [
      'CurrencyRate_source_providerReference_idx',
      'CurrencyRate_manual_providerReference_key',
      'Nasiya_shopId_importIdempotencyKey_key',
      'Nasiya_shopId_creationIdempotencyKey_key',
      'SupplierPayable_deviceId_v2_key',
    ]) {
      expect(preflight).toContain(`'${index}'`)
    }
    expect(preflight).toContain('index_row.indisvalid AS is_valid')
    expect(preflight).toContain('index_row.indisready AS is_ready')
    expect(preflight).toContain('installed.predicate_sql IS DISTINCT FROM expected.predicate_sql')
    expect(preflight).toContain('constraint_row.convalidated')
    expect(preflight).toContain("'DeviceReturn_reconcile_allocations'")
    expect(preflight).toContain("'ReturnRefundAllocation_reconcile_return'")
    expect(preflight).toContain('appliedMigrationSet.has(\'202607230003_usd_uzs_evidence_integrity\')')
  })

  it('blocks future releases when a writer falls back to v1 after the rollout grace', () => {
    const start = preflight.indexOf("name: 'post_cutover_legacy_financial_writes'")
    const end = preflight.indexOf("name: 'financial_evidence_status_issues'", start)
    const monitor = preflight.slice(start, end)

    expect(monitor).toContain("INTERVAL '30 minutes'")
    expect(monitor).toContain("'202607230003_usd_uzs_evidence_integrity'")
    for (const table of [
      'CurrencyRate',
      'Device',
      'Sale',
      'SalePayment',
      'SupplierPayable',
      'SupplierPayablePayment',
      'Nasiya',
      'NasiyaPayment',
    ]) {
      expect(monitor).toContain(`FROM "${table}"`)
    }
    expect(monitor).toContain('FROM "ShopPayment"')
    expect(monitor).toContain('"paidAt" >= cutover.cutoff_at')
    expect(monitor).toContain('"createdAt" >= cutover.cutoff_at')
    expect(monitor).toContain("(CURRENT_TIMESTAMP AT TIME ZONE 'UTC') >= cutover.cutoff_at")
  })
})
