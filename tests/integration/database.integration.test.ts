import { afterAll, describe, expect, it } from 'vitest'
import { readdirSync } from 'node:fs'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@/generated/prisma/client'
import { Client } from 'pg'

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL
if (!databaseUrl) throw new Error('TEST_DATABASE_URL or DATABASE_URL is required')

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl, max: 2 }) })

afterAll(async () => {
  await prisma.$disconnect()
})

describe('disposable PostgreSQL migration foundation', () => {
  it('applies every checked-in migration successfully', async () => {
    const rows = await prisma.$queryRaw<Array<{ migration_name: string }>>`
      SELECT migration_name
      FROM _prisma_migrations
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
      ORDER BY migration_name
    `

    const checkedInMigrations = readdirSync('prisma/migrations', { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()

    expect(rows.map(({ migration_name }) => migration_name)).toEqual(checkedInMigrations)
  })

  it('installs nullable request correlation fields without storing historic network data', async () => {
    const columns = await prisma.$queryRaw<Array<{ table_name: string; column_name: string }>>`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND (table_name, column_name) IN (('Log', 'requestId'), ('OpsEvent', 'requestId'))
      ORDER BY table_name
    `
    expect(columns).toEqual([
      { table_name: 'Log', column_name: 'requestId' },
      { table_name: 'OpsEvent', column_name: 'requestId' },
    ])
  })

  it('installs live Telegram identity indexes and cross-role write guards', async () => {
    const indexes = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN ('SuperAdmin_telegramId_live_key', 'ShopAdmin_telegramId_live_key')
      ORDER BY indexname
    `
    expect(indexes.map(({ indexname }) => indexname)).toEqual([
      'ShopAdmin_telegramId_live_key',
      'SuperAdmin_telegramId_live_key',
    ])

    const triggers = await prisma.$queryRaw<Array<{ tgname: string }>>`
      SELECT tgname FROM pg_trigger
      WHERE NOT tgisinternal
        AND tgname IN ('SuperAdmin_telegram_identity_guard', 'ShopAdmin_telegram_identity_guard')
      ORDER BY tgname
    `
    expect(triggers.map(({ tgname }) => tgname)).toEqual([
      'ShopAdmin_telegram_identity_guard',
      'SuperAdmin_telegram_identity_guard',
    ])
  })

  it('preserves the migration-managed active-only unique indexes', async () => {
    const indexes = await prisma.$queryRaw<Array<{ indexname: string; indexdef: string }>>`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN (
          'Device_shopId_imei_active_key',
          'DeviceImei_shopId_normalizedValue_active_key',
          'Customer_shopId_normalizedPhone_active_key'
        )
      ORDER BY indexname
    `

    expect(indexes.map((index) => index.indexname)).toEqual([
      'Customer_shopId_normalizedPhone_active_key',
      'DeviceImei_shopId_normalizedValue_active_key',
      'Device_shopId_imei_active_key',
    ])
    expect(indexes.every((index) => index.indexdef.includes('WHERE'))).toBe(true)
  })

  it('installs IMEI normalization/search and tenant-aware relational constraints', async () => {
    const indexes = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN ('DeviceImei_value_trgm_active_idx', 'Customer_id_shopId_key', 'Sale_id_shopId_key')
      ORDER BY indexname
    `
    expect(indexes.map((row) => row.indexname)).toEqual([
      'Customer_id_shopId_key',
      'DeviceImei_value_trgm_active_idx',
      'Sale_id_shopId_key',
    ])

    const constraints = await prisma.$queryRaw<Array<{ conname: string; convalidated: boolean }>>`
      SELECT conname, convalidated
      FROM pg_constraint
      WHERE conname IN (
        'Sale_deviceId_shopId_fkey',
        'Sale_customerId_shopId_fkey',
        'Nasiya_deviceId_shopId_fkey',
        'DeviceReturn_deviceId_shopId_fkey'
      )
      ORDER BY conname
    `
    expect(constraints).toHaveLength(4)
    expect(constraints.every((row) => row.convalidated)).toBe(true)
  })

  it('installs the derived partial-phone document, synchronization trigger, and active trigram indexes', async () => {
    const columns = await prisma.$queryRaw<Array<{ column_name: string; column_default: string | null; is_nullable: string }>>`
      SELECT column_name, column_default, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'Customer'
        AND column_name = 'phoneSearchDigits'
    `
    expect(columns).toHaveLength(1)
    expect(columns[0]).toMatchObject({ column_name: 'phoneSearchDigits', is_nullable: 'NO' })
    expect(columns[0].column_default).toContain("''")

    const triggerFunctions = await prisma.$queryRaw<Array<{ trigger_definition: string; function_definition: string }>>`
      SELECT
        pg_get_triggerdef(t.oid) AS trigger_definition,
        pg_get_functiondef(p.oid) AS function_definition
      FROM pg_trigger t
      JOIN pg_proc p ON p.oid = t.tgfoid
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = 'Customer'
        AND NOT t.tgisinternal
        AND pg_get_functiondef(p.oid) LIKE '%phoneSearchDigits%'
    `
    expect(triggerFunctions).toHaveLength(1)
    expect(triggerFunctions[0].trigger_definition).toMatch(/BEFORE (INSERT OR UPDATE|UPDATE OR INSERT)/)
    expect(triggerFunctions[0].function_definition).toContain('additionalPhones')

    const searchDocumentFunctions = await prisma.$queryRaw<Array<{ function_definition: string }>>`
      SELECT pg_get_functiondef(p.oid) AS function_definition
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'customer_phone_search_digits'
    `
    expect(searchDocumentFunctions).toHaveLength(1)
    expect(searchDocumentFunctions[0].function_definition).toContain('|')

    const indexes = await prisma.$queryRaw<Array<{ tablename: string; indexdef: string }>>`
      SELECT tablename, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND (
          (tablename = 'Customer' AND indexdef LIKE '%"phoneSearchDigits"%gin_trgm_ops%')
          OR
          (tablename = 'DeviceImei' AND indexdef LIKE '%"normalizedValue"%gin_trgm_ops%')
        )
      ORDER BY tablename
    `
    expect(indexes.map(({ tablename }) => tablename)).toEqual(['Customer', 'DeviceImei'])
    expect(indexes.every(({ indexdef }) => /WHERE \({1,2}"deletedAt" IS NULL/.test(indexdef))).toBe(true)
    expect(indexes.find(({ tablename }) => tablename === 'DeviceImei')?.indexdef)
      .toContain('"normalizedValue" IS NOT NULL')
  })

  it('installs and validates the USD/UZS evidence constraints and append-only guards', async () => {
    const constraints = await prisma.$queryRaw<
      Array<{ conname: string; convalidated: boolean }>
    >`
      SELECT conname, convalidated
      FROM pg_constraint
      WHERE conname IN (
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
        'Nasiya_import_command_pair_check'
      )
      ORDER BY conname
    `
    expect(constraints).toHaveLength(11)
    expect(constraints.every((row) => row.convalidated)).toBe(true)

    const triggers = await prisma.$queryRaw<
      Array<{ tgname: string; tgdeferrable: boolean; tginitdeferred: boolean }>
    >`
      SELECT tgname, tgdeferrable, tginitdeferred
      FROM pg_trigger
      WHERE NOT tgisinternal
        AND tgname IN (
          'CurrencyRate_evidence_immutable',
          'ShopPayment_evidence_immutable',
          'Device_v2_purchase_evidence_immutable',
          'Device_acquisition_evidence_complete',
          'Sale_v2_creation_evidence_immutable',
          'SalePayment_evidence_immutable',
          'SalePayment_v2_components_immutable',
          'SalePayment_delete_immutable',
          'SalePayment_validate_v2_evidence',
          'Nasiya_v2_creation_evidence_immutable',
          'NasiyaPayment_evidence_immutable',
          'NasiyaPayment_validate_v2_evidence',
          'SupplierPayable_v2_creation_evidence_immutable',
          'SupplierPayable_device_acquisition_evidence_complete',
          'SupplierPayablePayment_immutable_trigger',
          'SupplierPayablePayment_validate_v2_evidence',
          'DevicePurchaseReceipt_immutable',
          'DevicePurchaseReceipt_validate_evidence'
        )
      ORDER BY tgname
    `
    expect(triggers).toHaveLength(18)
    expect(
      triggers
        .filter(({ tgname }) => tgname.endsWith('_acquisition_evidence_complete'))
        .every(({ tgdeferrable, tginitdeferred }) => tgdeferrable && tginitdeferred),
    ).toBe(true)

    const functionBody = await prisma.$queryRaw<Array<{ definition: string }>>`
      SELECT pg_get_functiondef(
        '"validate_return_refund_reconciliation"()'::regprocedure
      ) AS definition
    `
    expect(functionBody[0]?.definition).toContain(
      'refund allocation exceeds source receipt native amount',
    )
  })

  it('installs valid rate-observation and Nasiya command identity indexes', async () => {
    const indexes = await prisma.$queryRaw<
      Array<{
        indexname: string
        is_unique: boolean
        is_valid: boolean
        is_ready: boolean
        predicate_sql: string | null
      }>
    >`
      SELECT
        index_relation.relname AS indexname,
        index_row.indisunique AS is_unique,
        index_row.indisvalid AS is_valid,
        index_row.indisready AS is_ready,
        pg_get_expr(index_row.indpred, index_row.indrelid) AS predicate_sql
      FROM pg_index index_row
      JOIN pg_class index_relation ON index_relation.oid = index_row.indexrelid
      JOIN pg_namespace namespace_row ON namespace_row.oid = index_relation.relnamespace
      WHERE namespace_row.nspname = 'public'
        AND index_relation.relname IN (
          'CurrencyRate_source_providerReference_idx',
          'CurrencyRate_manual_providerReference_key',
          'Nasiya_shopId_importIdempotencyKey_key',
          'Nasiya_shopId_creationIdempotencyKey_key',
          'SupplierPayable_deviceId_v2_key'
        )
      ORDER BY index_relation.relname
    `

    expect(indexes).toEqual([
      {
        indexname: 'CurrencyRate_manual_providerReference_key',
        is_unique: true,
        is_valid: true,
        is_ready: true,
        predicate_sql:
          `((source = 'MANUAL'::text) AND ("providerReference" IS NOT NULL))`,
      },
      {
        indexname: 'CurrencyRate_source_providerReference_idx',
        is_unique: false,
        is_valid: true,
        is_ready: true,
        predicate_sql: null,
      },
      {
        indexname: 'Nasiya_shopId_creationIdempotencyKey_key',
        is_unique: true,
        is_valid: true,
        is_ready: true,
        predicate_sql: null,
      },
      {
        indexname: 'Nasiya_shopId_importIdempotencyKey_key',
        is_unique: true,
        is_valid: true,
        is_ready: true,
        predicate_sql: null,
      },
      {
        indexname: 'SupplierPayable_deviceId_v2_key',
        is_unique: true,
        is_valid: true,
        is_ready: true,
        predicate_sql: '("evidenceVersion" = 2)',
      },
    ])
  })

  it('allows repeated CBU observations but rejects duplicate MANUAL command identities', async () => {
    const client = new Client({ connectionString: databaseUrl })
    await client.connect()

    try {
      await client.query('BEGIN')
      const insertRate = `
        INSERT INTO "CurrencyRate" (
          id,
          "baseCurrency",
          "quoteCurrency",
          rate,
          source,
          "fetchedAt",
          "effectiveDate",
          "providerReference",
          "recordedById",
          "recordedByType",
          "evidenceVersion",
          "evidenceStatus"
        )
        VALUES ($1, 'USD', 'UZS', $2, $3, $4, $5, $6, $7, $8, 2, 'CAPTURED')
      `

      await client.query(insertRate, [
        'rate-cbu-repeat-a',
        12_500,
        'CBU',
        new Date('2026-07-23T06:00:00.000Z'),
        new Date('2026-07-23T00:00:00.000Z'),
        'cbu-observation-shared-reference',
        null,
        null,
      ])
      await client.query(insertRate, [
        'rate-cbu-repeat-b',
        12_510,
        'CBU',
        new Date('2026-07-23T06:05:00.000Z'),
        new Date('2026-07-23T00:00:00.000Z'),
        'cbu-observation-shared-reference',
        null,
        null,
      ])

      const repeatedCbu = await client.query<{ count: string }>(
        `
          SELECT COUNT(*)::text AS count
          FROM "CurrencyRate"
          WHERE source = 'CBU'
            AND "providerReference" = 'cbu-observation-shared-reference'
            AND "evidenceVersion" = 2
        `,
      )
      expect(repeatedCbu.rows[0]?.count).toBe('2')

      await client.query(insertRate, [
        'rate-manual-command-a',
        12_520,
        'MANUAL',
        new Date('2026-07-23T06:10:00.000Z'),
        new Date('2026-07-23T00:00:00.000Z'),
        'manual-command-shared-reference',
        'release-test-actor',
        'SUPER_ADMIN',
      ])

      let duplicateManualError: unknown
      try {
        await client.query(insertRate, [
          'rate-manual-command-b',
          12_530,
          'MANUAL',
          new Date('2026-07-23T06:15:00.000Z'),
          new Date('2026-07-23T00:00:00.000Z'),
          'manual-command-shared-reference',
          'release-test-actor',
          'SUPER_ADMIN',
        ])
      } catch (error) {
        duplicateManualError = error
      }

      const postgresError = duplicateManualError as {
        code?: string
        constraint?: string
      }
      expect(postgresError.code).toBe('23505')
      expect(postgresError.constraint).toBe('CurrencyRate_manual_providerReference_key')
    } finally {
      await client.query('ROLLBACK').catch(() => undefined)
      await client.end()
    }
  })
})
