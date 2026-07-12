import { afterAll, describe, expect, it } from 'vitest'
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

    expect(rows).toHaveLength(24)
    expect(rows.at(-1)?.migration_name).toBe('202607110001_add_sold_debt_device_status')
  })

  it('preserves the migration-managed active-only unique indexes', async () => {
    const indexes = await prisma.$queryRaw<Array<{ indexname: string; indexdef: string }>>`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN (
          'Device_shopId_imei_active_key',
          'Customer_shopId_normalizedPhone_active_key'
        )
      ORDER BY indexname
    `

    expect(indexes.map((index) => index.indexname)).toEqual([
      'Customer_shopId_normalizedPhone_active_key',
      'Device_shopId_imei_active_key',
    ])
    expect(indexes.every((index) => index.indexdef.includes('WHERE'))).toBe(true)
  })
})
