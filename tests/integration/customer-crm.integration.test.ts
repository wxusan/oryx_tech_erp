import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient, Prisma } from '@/generated/prisma/client'
import { customerSearchWhere } from '@/lib/server/customer-search'
import { getCustomerProfileHistory, getCustomerProfileOverview } from '@/lib/server/customer-profile'
import { getCustomerProfileAnalytics } from '@/lib/server/customer-profile-analytics'
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
      where: customerSearchWhere(first.id, 'AB 7654321'),
      select: { id: true, name: true, passportIdentifierLast4: true },
    })
    expect(rows).toEqual([{ id: target.id, name: 'Passport target', passportIdentifierLast4: '4321' }])
    expect(await prisma.customer.findMany({
      where: customerSearchWhere(first.id, 'AB7654'),
      select: { id: true },
    })).toEqual([])
    expect(JSON.stringify(rows)).not.toContain('AB7654321')
    expect(await getCustomerProfileOverview({
      shopId: second.id,
      customerId: target.id,
      visibility: { includeOwnerFinancials: true },
    })).toBeNull()
  })

  it('trigger-maintains delimiter-safe partial phone search across Prisma and direct SQL updates', async () => {
    const [{ shop: first }, { shop: second }] = await Promise.all([createShop('203'), createShop('204')])
    const target = await prisma.customer.create({
      data: {
        shopId: first.id,
        name: 'Additional phone target',
        phone: '+998 (90) 111-22-33',
        normalizedPhone: '998901112233',
        additionalPhones: ['+998 (95) 002-44-67', '+998 93 700 00 00'],
      },
    })
    const crossBoundary = await prisma.customer.create({
      data: {
        shopId: first.id,
        name: 'Cross phone boundary decoy',
        phone: '+998 90 000 00 24',
        normalizedPhone: '998900000024',
        additionalPhones: ['46', '+998 91 100 00 00'],
      },
    })
    await prisma.customer.create({
      data: {
        shopId: first.id,
        name: 'Separated digits decoy',
        phone: '+998 90 200 40 04',
        normalizedPhone: '998902004004',
        additionalPhones: ['+998 90 200 40 06'],
      },
    })
    await prisma.customer.create({
      data: {
        shopId: second.id,
        name: 'Other tenant phone target',
        phone: '+998 90 124 46 78',
        normalizedPhone: '998901244678',
      },
    })
    const deleted = await prisma.customer.create({
      data: {
        shopId: first.id,
        name: 'Deleted phone target',
        phone: '+998 90 124 46 79',
        normalizedPhone: '998901244679',
      },
    })
    await prisma.customer.update({
      where: { id: deleted.id },
      data: { deletedAt: new Date(), deletedBy: 'integration', deleteNote: 'search scope' },
    })

    const partialMatches = await prisma.customer.findMany({
      where: customerSearchWhere(first.id, '2446'),
      select: { id: true },
      orderBy: { id: 'asc' },
    })
    expect(partialMatches.map(({ id }) => id)).toEqual([target.id])
    expect(partialMatches.map(({ id }) => id)).not.toContain(crossBoundary.id)

    const [document] = await prisma.$queryRaw<Array<{ phoneSearchDigits: string }>>(Prisma.sql`
      SELECT "phoneSearchDigits"
      FROM "Customer"
      WHERE "id" = ${target.id}
    `)
    expect(document.phoneSearchDigits).toContain('|998901112233|')
    expect(document.phoneSearchDigits).toContain('|998950024467|')
    expect(document.phoneSearchDigits).toContain('|998937000000|')

    await prisma.customer.update({
      where: { id: target.id },
      data: { additionalPhones: ['+998 (97) 008-80-81'] },
    })
    expect(await prisma.customer.findMany({
      where: customerSearchWhere(first.id, '8808'),
      select: { id: true },
    })).toEqual([{ id: target.id }])
    expect(await prisma.customer.findMany({
      where: customerSearchWhere(first.id, '2446'),
      select: { id: true },
    })).toEqual([])

    await prisma.$executeRaw(Prisma.sql`
      UPDATE "Customer"
      SET "phone" = '+998 (88) 700-24-46',
          "normalizedPhone" = '998887002446',
          "additionalPhones" = ARRAY['+998 (99) 300-30-30']::text[]
      WHERE "id" = ${target.id}
    `)
    expect(await prisma.customer.findMany({
      where: customerSearchWhere(first.id, '2446'),
      select: { id: true },
    })).toEqual([{ id: target.id }])
    expect(await prisma.customer.findMany({
      where: customerSearchWhere(first.id, '8808'),
      select: { id: true },
    })).toEqual([])
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
    // Compatibility row proves customer reporting prefers the exact refund
    // input currency even when an old row has no native contract refund.
    await prisma.deviceReturn.create({
      data: {
        shopId: shop.id, deviceId: returnedDevice.id, saleId: returnedSale.id,
        idempotencyKey: 'crm-return', ledgerVersion: 1, refundAmount: 200,
        refundInputAmount: 0.2, refundInputCurrency: 'USD', refundExchangeRateAtCreation: 1_000, refundMethod: 'CASH',
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

    const { activeNasiya, schedule } = await prisma.$transaction(async (tx) => {
      const activeNasiya = await tx.nasiya.create({
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
      const schedule = await tx.nasiyaSchedule.create({
      data: {
        shopId: shop.id, nasiyaId: activeNasiya.id, monthNumber: 1,
        dueDate: new Date('2026-07-12T08:00:00.000Z'), expectedAmount: 4_400_000, paidAmount: 625_000,
        status: 'PARTIAL', contractCurrency: 'USD', contractExpectedAmount: 330,
        contractPaidAmount: 50, contractRemainingAmount: 280,
      },
      })
      return { activeNasiya, schedule }
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

    const writtenOff = await prisma.$transaction(async (tx) => {
      const writtenOff = await tx.nasiya.create({
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
      await tx.nasiyaSchedule.create({
        data: {
          shopId: shop.id,
          nasiyaId: writtenOff.id,
          monthNumber: 1,
          dueDate: new Date('2026-07-01T00:00:00.000Z'),
          expectedAmount: 500,
          contractExpectedAmount: 500,
          contractRemainingAmount: 500,
        },
      })
      return writtenOff
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
    expect(overview?.metrics.dueThisMonth).toEqual({ UZS: 400, USD: 280 })
    expect(overview?.metrics.overdue).toEqual({ UZS: 0, USD: 280 })
    expect(overview?.metrics.refunds).toEqual({ UZS: 0, USD: 0.2 })
    expect(overview?.metrics.writeOffs).toEqual({ UZS: 500, USD: 0 })
    expect(overview?.counts).toMatchObject({ devices: 4, sales: 2, activeNasiya: 1, writtenOffNasiya: 1, returns: 1 })

    const analytics = await getCustomerProfileAnalytics({
      shopId: shop.id,
      customerId: customer.id,
      months: 6,
      now: new Date('2026-07-13T10:00:00.000Z'),
      visibility: { includeOwnerFinancials: true },
    })
    expect(analytics).not.toBeNull()
    expect(analytics?.activity).toHaveLength(6)
    expect(analytics?.activity.map(({ month }) => month)).toEqual([
      '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07',
    ])
    expect(analytics?.obligations).toEqual({
      UZS: { overdue: 0, today: 400, next7Days: 0, days8To30: 0, later: 0 },
      USD: { overdue: 280, today: 0, next7Days: 0, days8To30: 0, later: 0 },
    })
    expect(analytics?.counts).toMatchObject({ devices: 4, sales: 2, nasiyas: 2, activeNasiyas: 1, returns: 1 })
    expect(analytics?.activity.at(-1)).toMatchObject({
      contracts: { UZS: 2500, USD: 430 },
      refunds: { UZS: 0, USD: 0.2 },
      writeOffs: { UZS: 500, USD: 0 },
    })
    expect(analytics?.obligations.UZS.today).toBe(overview?.metrics.dueThisMonth.UZS)
    expect(analytics?.obligations.USD.overdue).toBe(overview?.metrics.dueThisMonth.USD)
    expect(analytics?.obligations.USD.overdue).toBe(overview?.metrics.overdue.USD)

    const staffAnalytics = await getCustomerProfileAnalytics({
      shopId: shop.id,
      customerId: customer.id,
      months: 6,
      now: new Date('2026-07-13T10:00:00.000Z'),
      visibility: { includeOwnerFinancials: false },
    })
    expect(staffAnalytics?.visibility).toBe('OPERATIONAL')
    expect(JSON.stringify(staffAnalytics)).not.toContain('payments')
    expect(JSON.stringify(staffAnalytics)).not.toContain('refunds')
    expect(JSON.stringify(staffAnalytics)).not.toContain('writeOffs')

    const { shop: foreignShop } = await createShop('302')
    await expect(getCustomerProfileAnalytics({
      shopId: foreignShop.id,
      customerId: customer.id,
      months: 6,
      visibility: { includeOwnerFinancials: true },
    })).resolves.toBeNull()

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
    expect(firstPage.total).toBe(21)
    expect(firstPage.totalIsExact).toBe(false)
    expect(firstPage.hasNext).toBe(true)
    expect(secondPage.items).toHaveLength(6)
    expect(secondPage.total).toBe(26)
    expect(secondPage.hasNext).toBe(false)
    expect(new Set([...firstPage.items, ...secondPage.items].map(({ id }) => id))).toHaveLength(26)
  })

  it('buckets every effective due window and preserves payment-discipline semantics', async () => {
    const { owner, shop } = await createShop('401')
    const customer = await prisma.customer.create({
      data: { shopId: shop.id, name: 'Bucket customer', phone: '+998904444444', normalizedPhone: '998904444444' },
    })
    const [nasiyaDevice, usdDevice] = await Promise.all([
      prisma.device.create({ data: deviceData(shop.id, owner.id, '4011', 'SOLD_NASIYA') }),
      prisma.device.create({ data: deviceData(shop.id, owner.id, '4012', 'SOLD_CASH') }),
    ])
    const nasiya = await prisma.$transaction(async (tx) => {
      const created = await tx.nasiya.create({
        data: {
          shopId: shop.id, deviceId: nasiyaDevice.id, customerId: customer.id,
          totalAmount: 1000, downPayment: 0, baseRemainingAmount: 1000,
          finalNasiyaAmount: 1000, remainingAmount: 500, months: 7, monthlyPayment: 143,
          startDate: new Date('2026-01-01T00:00:00.000Z'), status: 'ACTIVE',
          contractCurrency: 'UZS', contractTotalAmount: 1000, contractBaseRemainingAmount: 1000,
          contractFinalAmount: 1000, contractRemainingAmount: 500, contractPaidAmount: 500,
          contractMonthlyPayment: 143, createdAt: new Date('2026-02-01T00:00:00.000Z'), createdBy: owner.id,
        },
      })
      await tx.nasiyaSchedule.createMany({
        data: [
          { id: 'crm-bucket-overdue', shopId: shop.id, nasiyaId: created.id, monthNumber: 1, dueDate: new Date('2026-07-10T08:00:00.000Z'), expectedAmount: 200, paidAmount: 100, status: 'PARTIAL', contractCurrency: 'UZS', contractExpectedAmount: 200, contractPaidAmount: 100, contractRemainingAmount: 100 },
          { id: 'crm-bucket-today', shopId: shop.id, nasiyaId: created.id, monthNumber: 2, dueDate: new Date('2026-07-13T08:00:00.000Z'), expectedAmount: 100, status: 'PENDING', contractCurrency: 'UZS', contractExpectedAmount: 100, contractRemainingAmount: 100 },
          { id: 'crm-bucket-next7', shopId: shop.id, nasiyaId: created.id, monthNumber: 3, dueDate: new Date('2026-07-01T08:00:00.000Z'), delayedUntil: new Date('2026-07-17T08:00:00.000Z'), expectedAmount: 100, status: 'DEFERRED', contractCurrency: 'UZS', contractExpectedAmount: 100, contractRemainingAmount: 100 },
          { id: 'crm-bucket-next30', shopId: shop.id, nasiyaId: created.id, monthNumber: 4, dueDate: new Date('2026-07-25T08:00:00.000Z'), expectedAmount: 100, status: 'PENDING', contractCurrency: 'UZS', contractExpectedAmount: 100, contractRemainingAmount: 100 },
          { id: 'crm-bucket-later', shopId: shop.id, nasiyaId: created.id, monthNumber: 5, dueDate: new Date('2026-08-20T08:00:00.000Z'), expectedAmount: 100, status: 'PENDING', contractCurrency: 'UZS', contractExpectedAmount: 100, contractRemainingAmount: 100 },
          { id: 'crm-bucket-on-time', shopId: shop.id, nasiyaId: created.id, monthNumber: 6, dueDate: new Date('2026-06-10T08:00:00.000Z'), expectedAmount: 200, paidAmount: 200, paidAt: new Date('2026-06-11T08:00:00.000Z'), status: 'PAID', contractCurrency: 'UZS', contractExpectedAmount: 200, contractPaidAmount: 200 },
          { id: 'crm-bucket-late', shopId: shop.id, nasiyaId: created.id, monthNumber: 7, dueDate: new Date('2026-05-10T08:00:00.000Z'), expectedAmount: 200, paidAmount: 200, paidAt: new Date('2026-05-15T08:00:00.000Z'), status: 'PAID', contractCurrency: 'UZS', contractExpectedAmount: 200, contractPaidAmount: 200 },
        ],
      })
      return created
    })
    await prisma.nasiyaPayment.createMany({
      data: [
        { shopId: shop.id, nasiyaId: nasiya.id, nasiyaScheduleId: 'crm-bucket-overdue', amount: 100, appliedAmountInContractCurrency: 100, paymentMethod: 'CASH', paidAt: new Date('2026-07-10T08:00:00.000Z'), idempotencyKey: 'crm-bucket-partial-payment', createdBy: owner.id },
        { shopId: shop.id, nasiyaId: nasiya.id, nasiyaScheduleId: 'crm-bucket-on-time', amount: 200, appliedAmountInContractCurrency: 200, paymentMethod: 'CARD', paidAt: new Date('2026-06-11T08:00:00.000Z'), idempotencyKey: 'crm-bucket-on-time-payment', createdBy: owner.id },
        { shopId: shop.id, nasiyaId: nasiya.id, nasiyaScheduleId: 'crm-bucket-late', amount: 200, appliedAmountInContractCurrency: 200, paymentMethod: 'TRANSFER', paidAt: new Date('2026-05-15T08:00:00.000Z'), idempotencyKey: 'crm-bucket-late-payment', createdBy: owner.id },
        { shopId: shop.id, nasiyaId: nasiya.id, amount: 999, appliedAmountInContractCurrency: 999, paymentMethod: 'CASH', paidAt: new Date('2026-07-12T08:00:00.000Z'), idempotencyKey: 'crm-bucket-deleted-payment', deletedAt: new Date('2026-07-12T09:00:00.000Z'), deletedBy: owner.id, deleteNote: 'Integration exclusion', createdBy: owner.id },
      ],
    })
    const usdSale = await prisma.sale.create({
      data: {
        shopId: shop.id, deviceId: usdDevice.id, customerId: customer.id,
        salePrice: 1_250_000, paymentMethod: 'CASH', paidFully: true, amountPaid: 1_250_000,
        contractCurrency: 'USD', contractSalePrice: 100, contractAmountPaid: 100,
        contractRemainingAmount: 0, createdAt: new Date('2026-04-01T00:00:00.000Z'), createdBy: owner.id,
      },
    })
    await prisma.salePayment.create({
      data: {
        shopId: shop.id, saleId: usdSale.id, amount: 1_250_000, paymentMethod: 'CASH',
        appliedAmountInContractCurrency: null, paidAt: new Date('2026-04-01T00:00:00.000Z'),
        idempotencyKey: 'crm-bucket-legacy-usd', createdBy: owner.id,
      },
    })

    const analytics = await getCustomerProfileAnalytics({
      shopId: shop.id,
      customerId: customer.id,
      months: 6,
      now: new Date('2026-07-13T10:00:00.000Z'),
      visibility: { includeOwnerFinancials: true },
    })
    expect(analytics?.obligations.UZS).toEqual({ overdue: 100, today: 100, next7Days: 100, days8To30: 100, later: 100 })
    expect(analytics?.discipline).toEqual({
      paidInstallments: 2,
      onTimeInstallments: 1,
      lateInstallments: 1,
      onTimeRatio: 0.5,
      maxDaysLate: 5,
      currentOverdueSchedules: 1,
    })
    expect(analytics?.caveats.legacyUsdPaymentCount).toBe(1)
    expect(analytics?.activity.reduce((total, row) => total + (row.payments?.UZS ?? 0), 0)).toBe(500)
  })
})
