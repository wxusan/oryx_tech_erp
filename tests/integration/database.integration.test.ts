import { afterAll, describe, expect, it } from 'vitest'
import { readdirSync } from 'node:fs'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@/generated/prisma/client'

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
})
