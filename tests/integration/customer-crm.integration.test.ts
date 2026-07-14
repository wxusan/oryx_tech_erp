import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient, Prisma } from '@/generated/prisma/client'
import { customerSearchWhere } from '@/lib/server/customer-search'
import { getCustomerProfileHistory, getCustomerProfileOverview } from '@/lib/server/customer-profile'
import { passportIdentifierStorage } from '@/lib/customer-passport'

process.env.CUSTOMER_PII_ENCRYPTION_KEY = 'integration-encryption-key-customer-crm-2026-very-long'
process.env.CUSTOMER_PII_SEARCH_KEY = 'integration-search-key-customer-crm-2026-very-long'

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL
if (!databaseUrl) throw new Error('TEST_DATABASE_URL or DATABASE_URL is required')
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl, max: 3 }) })

async function reset() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "ReminderGenerationState", "AuthSession", "ChangeEvent", "OpsEvent", "Log", "Notification",
      "ReturnRefundAllocation", "DeviceReturn", "NasiyaResolutionEvent", "NasiyaDeferral",
      "NasiyaPayment", "NasiyaSchedule", "Nasiya", "SupplierPayable", "SalePayment", "Sale",
      "Customer", "DeviceImei", "Device", "Supplier", "ShopAdmin", "ShopPayment", "CurrencyRate",
      "ShopPackageFeature", "ShopPackageVersion", "ShopMemberPermission", "Shop", "SuperAdmin"
    RESTART IDENTITY CASCADE
  `)
}

async function createShop(suffix: string) {
  const owner = await prisma.superAdmin.create({
    data: { name: `CRM owner ${suffix}`, login: `crm-owner-${suffix}`, passwordHash: 'test-only' },
  })
  const shop = await prisma.shop.create({
    data: {
      name: `CRM shop ${suffix}`,
      ownerName: owner.name,
      ownerPhone: `+99890${suffix.padStart(7, '0').slice(-7)}`,
      shopNumber: suffix,
      address: 'Disposable integration database',
      subscriptionDue: new Date('2099-01-01T00:00:00.000Z'),
      createdById: owner.id,
    },
  })
  return { owner, shop }
}

function deviceData(shopId: string, actorId: string, suffix: string, status: 'SOLD_CASH' | 'SOLD_DEBT' | 'SOLD_NASIYA') {
  return {
    shopId,
    model: `CRM phone ${suffix}`,
    purchasePrice: 500,
    purchaseInputAmount: 500,
    purchaseAmountUzsSnapshot: 500,
    imei: `CRM-${suffix}`,
    status,
    addedBy: actorId,
  } as const
}

describe('customer CRM database privacy and set-based metrics', () => {
  beforeAll(reset)
  afterAll(async () => prisma.$disconnect())

  it('enforces active tenant passport collisions while allowing another tenant and deleted history', async () => {
    const [{ shop: first }, { shop: second }] = await Promise.all([createShop('101'), createShop('102')])
    const storage = passportIdentifierStorage('AA 1234567')
    const customer = await prisma.customer.create({
      data: { shopId: first.id, name: 'First customer', phone: '+998901234567', normalizedPhone: '998901234567', ...storage },
    })

    await expect(prisma.customer.create({
      data: { shopId: first.id, name: 'Collision', phone: '+998901234568', normalizedPhone: '998901234568', ...storage },
    })).rejects.toMatchObject({ code: 'P2002' })

    await expect(prisma.customer.create({
      data: { shopId: second.id, name: 'Other tenant', phone: '+998901234567', normalizedPhone: '998901234567', ...storage },
    })).resolves.toMatchObject({ shopId: second.id })

    await prisma.customer.update({ where: { id: customer.id }, data: { deletedAt: new Date(), deletedBy: 'integration', deleteNote: 'collision policy' } })
    await expect(prisma.customer.create({
      data: { shopId: first.id, name: 'Replacement', phone: '+998901234569', normalizedPhone: '998901234569', ...storage },
    })).resolves.toMatchObject({ shopId: first.id })

    await expect(prisma.$executeRaw(Prisma.sql`
      INSERT INTO "Customer" ("id", "shopId", "name", "phone", "passportIdentifierHash", "createdAt")
      VALUES ('crm-partial-bundle', ${first.id}, 'Broken bundle', '+998901111111', 'hash-only', CURRENT_TIMESTAMP)
    `)).rejects.toThrow()
  })

  it('keeps exact passport search tenant scoped and never returns encrypted material', async () => {
    const [{ shop: first }, { shop: second }] = await Promise.all([createShop('201'), createShop('202')])
    const storage = passportIdentifierStorage('AB 7654321')
    const target = await prisma.customer.create({
      data: { shopId: first.id, name: 'Passport target', phone: '+998907654321', normalizedPhone: '998907654321', ...storage },
    })
    await prisma.customer.create({
      data: { shopId: second.id, name: 'Other target', phone: '+998917654321', normalizedPhone: '998917654321', ...storage },
    })

    const rows = await prisma.customer.findMany({
      where: customerSearchWhere(first.id, 'ab-7654321'),
      select: { id: true, name: true, passportIdentifierLast4: true },
    })
    expect(rows).toEqual([{ id: target.id, name: 'Passport target', passportIdentifierLast4: '4321' }])
    expect(JSON.stringify(rows)).not.toContain('AB7654321')
    expect(await getCustomerProfileOverview({
      shopId: second.id,
      customerId: target.id,
      visibility: { includeOwnerFinancials: true },
    })).toBeNull()
  })

  it('partitions currencies, respects Tashkent due boundaries, and paginates every history', async () => {
    const { owner, shop } = await createShop('301')
    const customer = await prisma.customer.create({
      data: { shopId: shop.id, name: 'Metric customer', phone: '+998903333333', normalizedPhone: '998903333333' },
    })
    const [returnedDevice, dueDevice, activeNasiyaDevice, writeOffDevice] = await Promise.all([
      prisma.device.create({ data: deviceData(shop.id, owner.id, '3011', 'SOLD_CASH') }),
      prisma.device.create({ data: deviceData(shop.id, owner.id, '3012', 'SOLD_DEBT') }),
      prisma.device.create({ data: deviceData(shop.id, owner.id, '3013', 'SOLD_NASIYA') }),
      prisma.device.create({ data: deviceData(shop.id, owner.id, '3014', 'SOLD_NASIYA') }),
    ])
    const dueToday = new Date('2026-07-13T08:00:00.000Z')
    const returnedSale = await prisma.sale.create({
      data: {
        shopId: shop.id, deviceId: returnedDevice.id, customerId: customer.id,
        salePrice: 1000, paymentMethod: 'CASH', paidFully: false, amountPaid: 600, remainingAmount: 400,
        contractCurrency: 'UZS', contractSalePrice: 1000, contractAmountPaid: 600, contractRemainingAmount: 400,
        returnedAt: new Date('2026-07-12T10:00:00.000Z'), returnedBy: owner.id, createdBy: owner.id,
      },
    })
    await prisma.salePayment.create({
      data: {
        shopId: shop.id, saleId: returnedSale.id, amount: 600, paymentMethod: 'CASH',
        appliedAmountInContractCurrency: 600, idempotencyKey: 'crm-returned-payment', createdBy: owner.id,
      },
    })
    // Compatibility row proves the profile mirrors report fallback semantics:
    // old returns may have refundAmount but no native contractRefundAmount.
    await prisma.deviceReturn.create({
      data: {
        shopId: shop.id, deviceId: returnedDevice.id, saleId: returnedSale.id,
        idempotencyKey: 'crm-return', ledgerVersion: 1, refundAmount: 200,
        refundInputAmount: 200, refundInputCurrency: 'UZS', refundMethod: 'CASH',
        contractCurrency: 'UZS', contractAmount: 1000, contractReceiptsAtReturn: 0,
        contractRefundAmount: 0, contractRetainedAmount: 0, contractCancelledDebt: 0,
        revenueReversalAmountUzs: 1000, inventoryCostRecoveryUzs: 500,
        note: 'Customer return', createdBy: owner.id,
      },
    })

    const dueSale = await prisma.sale.create({
      data: {
        shopId: shop.id, deviceId: dueDevice.id, customerId: customer.id,
        salePrice: 1000, paymentMethod: 'CARD', paidFully: false, amountPaid: 600, remainingAmount: 400,
        dueDate: dueToday, contractCurrency: 'UZS', contractSalePrice: 1000,
        contractAmountPaid: 600, contractRemainingAmount: 400, createdBy: owner.id,
      },
    })
    await prisma.salePayment.create({
      data: {
        shopId: shop.id, saleId: dueSale.id, amount: 600, paymentMethod: 'CARD',
        appliedAmountInContractCurrency: 600, idempotencyKey: 'crm-due-payment', createdBy: owner.id,
      },
    })

    const activeNasiya = await prisma.nasiya.create({
      data: {
        shopId: shop.id, deviceId: activeNasiyaDevice.id, customerId: customer.id,
        totalAmount: 5_000_000, downPayment: 1_000_000, baseRemainingAmount: 4_000_000,
        interestPercent: 10, interestAmount: 400_000, finalNasiyaAmount: 4_400_000, remainingAmount: 2_800_000,
        months: 1, monthlyPayment: 4_400_000, startDate: new Date('2026-06-01T00:00:00.000Z'),
        contractCurrency: 'USD', contractExchangeRateAtCreation: 12_500,
        contractTotalAmount: 400, contractDownPayment: 100, contractBaseRemainingAmount: 300,
        contractInterestAmount: 30, contractFinalAmount: 330, contractMonthlyPayment: 330,
        contractRemainingAmount: 280, contractPaidAmount: 50, createdBy: owner.id,
      },
    })
    const schedule = await prisma.nasiyaSchedule.create({
      data: {
        shopId: shop.id, nasiyaId: activeNasiya.id, monthNumber: 1,
        dueDate: new Date('2026-07-12T08:00:00.000Z'), expectedAmount: 4_400_000, paidAmount: 625_000,
        status: 'PARTIAL', contractCurrency: 'USD', contractExpectedAmount: 330,
        contractPaidAmount: 50, contractRemainingAmount: 280,
      },
    })
    await prisma.nasiyaPayment.createMany({
      data: [
        { shopId: shop.id, nasiyaId: activeNasiya.id, amount: 1_250_000, paymentMethod: 'CASH', appliedAmountInContractCurrency: 100, idempotencyKey: 'crm-down', createdBy: owner.id },
        { shopId: shop.id, nasiyaId: activeNasiya.id, nasiyaScheduleId: schedule.id, amount: 625_000, paymentMethod: 'TRANSFER', appliedAmountInContractCurrency: 50, idempotencyKey: 'crm-schedule', createdBy: owner.id },
      ],
    })
    await prisma.nasiyaPayment.create({
      data: {
        shopId: shop.id, nasiyaId: activeNasiya.id, amount: 125_000, paymentMethod: 'CARD',
        paymentInputAmount: 10, paymentInputCurrency: 'USD', paymentExchangeRate: 12_500,
        appliedAmountInContractCurrency: null, idempotencyKey: 'crm-legacy-usd-fallback', createdBy: owner.id,
      },
    })

    const writtenOff = await prisma.nasiya.create({
      data: {
        shopId: shop.id, deviceId: writeOffDevice.id, customerId: customer.id,
        totalAmount: 500, downPayment: 0, baseRemainingAmount: 500, finalNasiyaAmount: 500,
        remainingAmount: 500, months: 1, monthlyPayment: 500, startDate: new Date('2026-06-01T00:00:00.000Z'),
        resolutionState: 'WRITTEN_OFF', resolutionUpdatedAt: new Date('2026-07-10T00:00:00.000Z'),
        contractCurrency: 'UZS', contractTotalAmount: 500, contractBaseRemainingAmount: 500,
        contractFinalAmount: 500, contractMonthlyPayment: 500, contractRemainingAmount: 500,
        createdBy: owner.id,
      },
    })
    await prisma.nasiyaResolutionEvent.create({
      data: {
        shopId: shop.id, nasiyaId: writtenOff.id, eventType: 'WRITE_OFF', previousState: 'ACTIVE', newState: 'WRITTEN_OFF',
        contractCurrency: 'UZS', nativeRemainingAmount: 500, frozenUzsAmount: 500, frozenUsdUzsRate: 12_500,
        reason: 'Uncollectible', actorId: owner.id, actorType: 'SUPER_ADMIN', idempotencyKey: 'crm-writeoff',
      },
    })

    const overview = await getCustomerProfileOverview({
      shopId: shop.id,
      customerId: customer.id,
      now: new Date('2026-07-13T10:00:00.000Z'),
      visibility: { includeOwnerFinancials: true },
    })
    expect(overview).not.toBeNull()
    expect(overview?.metrics.contractValue).toEqual({ UZS: 2500, USD: 430 })
    expect(overview?.metrics.cashCollected).toEqual({ UZS: 1200, USD: 160 })
    expect(overview?.metrics.legacyUsdPaymentCount).toBe(0)
    expect(overview?.metrics.dueToday).toEqual({ UZS: 400, USD: 0 })
    expect(overview?.metrics.overdue).toEqual({ UZS: 0, USD: 280 })
    expect(overview?.metrics.refunds).toEqual({ UZS: 200, USD: 0 })
    expect(overview?.metrics.writeOffs).toEqual({ UZS: 500, USD: 0 })
    expect(overview?.counts).toMatchObject({ devices: 4, sales: 2, activeNasiya: 1, writtenOffNasiya: 1, returns: 1 })

    await prisma.salePayment.createMany({
      data: Array.from({ length: 21 }, (_, index) => ({
        shopId: shop.id,
        saleId: dueSale.id,
        amount: 1,
        paymentMethod: 'CASH' as const,
        appliedAmountInContractCurrency: 1,
        idempotencyKey: `crm-pagination-${index}`,
        createdBy: owner.id,
      })),
    })
    const firstPage = await getCustomerProfileHistory({ shopId: shop.id, customerId: customer.id, section: 'payments', page: 1 })
    const secondPage = await getCustomerProfileHistory({ shopId: shop.id, customerId: customer.id, section: 'payments', page: 2 })
    expect(firstPage.items).toHaveLength(20)
    expect(firstPage.total).toBe(26)
    expect(secondPage.items).toHaveLength(6)
    expect(new Set([...firstPage.items, ...secondPage.items].map(({ id }) => id))).toHaveLength(26)
  })
})
