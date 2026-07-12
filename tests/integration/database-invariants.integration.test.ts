import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { PrismaPg } from '@prisma/adapter-pg'
import { Prisma, PrismaClient } from '@/generated/prisma/client'

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL
if (!databaseUrl) throw new Error('TEST_DATABASE_URL or DATABASE_URL is required')

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl, max: 4 }) })

async function resetBusinessData() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "OpsEvent", "Log", "Notification", "DeviceReturn",
      "NasiyaDeferral", "NasiyaPayment", "NasiyaSchedule", "Nasiya",
      "SupplierPayable", "SalePayment", "Sale", "Customer", "Device",
      "Supplier", "ShopAdmin", "ShopPayment", "CurrencyRate", "Shop", "SuperAdmin"
    RESTART IDENTITY CASCADE
  `)
}

async function seedShop(suffix: string) {
  const owner = await prisma.superAdmin.create({
    data: {
      name: `Owner ${suffix}`,
      login: `owner_${suffix}`,
      passwordHash: 'integration-only',
    },
  })
  const shop = await prisma.shop.create({
    data: {
      name: `Shop ${suffix}`,
      ownerName: `Owner ${suffix}`,
      ownerPhone: `+99890000${suffix.padStart(4, '0')}`,
      shopNumber: suffix,
      address: 'Integration test',
      subscriptionDue: new Date('2099-01-01T00:00:00.000Z'),
      createdById: owner.id,
    },
  })
  return { owner, shop }
}

beforeEach(resetBusinessData)

afterAll(async () => {
  await prisma.$disconnect()
})

describe('migration-managed active-only uniqueness', () => {
  it('rejects a duplicate active IMEI per shop and permits reuse after soft delete', async () => {
    const { shop } = await seedShop('imei')
    const first = await prisma.device.create({
      data: {
        shopId: shop.id,
        model: 'Phone A',
        purchasePrice: 1_000_000,
        imei: '123456789012345',
        addedBy: 'integration',
      },
    })

    await expect(
      prisma.device.create({
        data: {
          shopId: shop.id,
          model: 'Phone B',
          purchasePrice: 1_000_000,
          imei: first.imei,
          addedBy: 'integration',
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' })

    await prisma.device.update({ where: { id: first.id }, data: { deletedAt: new Date() } })
    const reused = await prisma.device.create({
      data: {
        shopId: shop.id,
        model: 'Phone C',
        purchasePrice: 1_000_000,
        imei: first.imei,
        addedBy: 'integration',
      },
    })
    expect(reused.imei).toBe(first.imei)
  })

  it('rejects a duplicate active normalized phone per shop and permits reuse after soft delete', async () => {
    const { shop } = await seedShop('phone')
    const first = await prisma.customer.create({
      data: { shopId: shop.id, name: 'Customer A', phone: '+998901234567', normalizedPhone: '998901234567' },
    })

    await expect(
      prisma.customer.create({
        data: { shopId: shop.id, name: 'Customer B', phone: '90 123 45 67', normalizedPhone: '998901234567' },
      }),
    ).rejects.toMatchObject({ code: 'P2002' })

    await prisma.customer.update({ where: { id: first.id }, data: { deletedAt: new Date() } })
    const reused = await prisma.customer.create({
      data: { shopId: shop.id, name: 'Customer C', phone: '+998901234567', normalizedPhone: '998901234567' },
    })
    expect(reused.normalizedPhone).toBe('998901234567')
  })
})

describe('database idempotency constraints', () => {
  it('allows only one sale payment for a shop/idempotency key', async () => {
    const { shop } = await seedShop('idem')
    const customer = await prisma.customer.create({
      data: { shopId: shop.id, name: 'Customer', phone: '+998901111111', normalizedPhone: '998901111111' },
    })
    const device = await prisma.device.create({
      data: { shopId: shop.id, model: 'Phone', purchasePrice: 500_000, imei: '999999999999999', addedBy: 'integration', status: 'SOLD_DEBT' },
    })
    const sale = await prisma.sale.create({
      data: {
        shopId: shop.id,
        deviceId: device.id,
        customerId: customer.id,
        salePrice: 1_000_000,
        amountPaid: 100_000,
        remainingAmount: 900_000,
        contractSalePrice: 1_000_000,
        contractAmountPaid: 100_000,
        contractRemainingAmount: 900_000,
        paymentMethod: 'CASH',
        paidFully: false,
        createdBy: 'integration',
      },
    })

    const data: Prisma.SalePaymentUncheckedCreateInput = {
      saleId: sale.id,
      shopId: shop.id,
      amount: 100_000,
      paymentMethod: 'CASH',
      idempotencyKey: 'integration-idempotency-key',
      createdBy: 'integration',
    }
    await prisma.salePayment.create({ data })
    await expect(prisma.salePayment.create({ data })).rejects.toMatchObject({ code: 'P2002' })
    expect(await prisma.salePayment.count({ where: { shopId: shop.id } })).toBe(1)
  })
})
