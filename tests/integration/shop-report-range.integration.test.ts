import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@/generated/prisma/client'
import { resolveReportRange } from '@/lib/report-range'
import { getShopRangeReport, getShopReportDataMonths } from '@/lib/server/shop-report-range'

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL
if (!databaseUrl) throw new Error('TEST_DATABASE_URL or DATABASE_URL is required')

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl, max: 4 }) })

beforeEach(async () => {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "ReminderGenerationState", "AuthSession", "ChangeEvent", "OpsEvent", "Log", "Notification", "ReturnRefundAllocation", "DeviceReturn",
      "NasiyaResolutionEvent", "NasiyaDeferral", "NasiyaPayment", "NasiyaSchedule", "Nasiya",
      "SupplierPayable", "SalePayment", "Sale", "Customer", "DeviceImei", "Device",
      "Supplier", "ShopAdmin", "ShopPayment", "CurrencyRate", "Shop", "SuperAdmin"
    RESTART IDENTITY CASCADE
  `)
})

afterAll(async () => {
  await prisma.$disconnect()
})

async function seedBase(createdAt = new Date('2026-02-01T00:00:00.000Z')) {
  const owner = await prisma.superAdmin.create({
    data: { name: 'Report owner', login: 'report-owner', passwordHash: 'integration-only' },
  })
  const shop = await prisma.shop.create({
    data: {
      name: 'Range report shop',
      ownerName: owner.name,
      ownerPhone: '+998901111111',
      shopNumber: 'REPORT-RANGE',
      address: 'Disposable database',
      subscriptionDue: new Date('2099-01-01T00:00:00.000Z'),
      createdById: owner.id,
      createdAt,
    },
  })
  const customer = await prisma.customer.create({
    data: { shopId: shop.id, name: 'Report customer', phone: '+998909999999', normalizedPhone: '998909999999' },
  })

  let sequence = 0
  async function device(purchasePrice: number, status: 'IN_STOCK' | 'SOLD_CASH' | 'SOLD_NASIYA') {
    sequence += 1
    return prisma.device.create({
      data: {
        shopId: shop.id,
        model: `Report device ${sequence}`,
        imei: `REPORT-${sequence}`,
        purchasePrice,
        purchaseInputAmount: purchasePrice,
        purchaseAmountUzsSnapshot: purchasePrice,
        status,
        addedBy: owner.id,
      },
    })
  }

  return { owner, shop, customer, device }
}

describe('dynamic shop range report', () => {
  it('offers every ERP usage month from provisioning through the current Tashkent month', async () => {
    const { owner, shop, customer, device } = await seedBase()
    await device(100, 'IN_STOCK')
    const sold = await device(600, 'SOLD_CASH')
    const sale = await prisma.sale.create({
      data: {
        shopId: shop.id,
        deviceId: sold.id,
        customerId: customer.id,
        salePrice: 1_000,
        amountPaid: 0,
        remainingAmount: 1_000,
        contractSalePrice: 1_000,
        contractAmountPaid: 0,
        contractRemainingAmount: 1_000,
        paymentMethod: 'CASH',
        paidFully: false,
        dueDate: new Date('2026-03-01T00:00:00.000Z'),
        // 2026-02-01 00:30 in Tashkent, still January in UTC.
        createdAt: new Date('2026-01-31T19:30:00.000Z'),
        createdBy: owner.id,
      },
    })
    await prisma.salePayment.create({
      data: {
        shopId: shop.id,
        saleId: sale.id,
        amount: 100,
        appliedAmountInContractCurrency: 100,
        paymentMethod: 'CASH',
        paidAt: new Date('2026-03-01T00:00:00.000Z'),
        createdBy: owner.id,
      },
    })

    await expect(getShopReportDataMonths(shop.id, new Date('2026-07-14T12:00:00.000Z')))
      .resolves.toEqual(['2026-07', '2026-06', '2026-05', '2026-04', '2026-03', '2026-02'])
  })

  it('never exposes future nasiya or debt due dates as report months', async () => {
    const { owner, shop, customer, device } = await seedBase()
    const saleDevice = await device(600, 'SOLD_CASH')
    await prisma.sale.create({
      data: {
        shopId: shop.id,
        deviceId: saleDevice.id,
        customerId: customer.id,
        salePrice: 1_000,
        amountPaid: 0,
        remainingAmount: 1_000,
        contractSalePrice: 1_000,
        contractAmountPaid: 0,
        contractRemainingAmount: 1_000,
        paymentMethod: 'CASH',
        paidFully: false,
        dueDate: new Date('2026-05-10T00:00:00.000Z'),
        createdAt: new Date('2026-02-01T00:00:00.000Z'),
        createdBy: owner.id,
      },
    })

    const nasiyaDevice = await device(700, 'SOLD_NASIYA')
    const nasiya = await prisma.nasiya.create({
      data: {
        shopId: shop.id,
        deviceId: nasiyaDevice.id,
        customerId: customer.id,
        totalAmount: 1_200,
        downPayment: 0,
        baseRemainingAmount: 1_200,
        interestAmount: 0,
        finalNasiyaAmount: 1_200,
        remainingAmount: 1_200,
        months: 1,
        monthlyPayment: 1_200,
        startDate: new Date('2026-02-01T00:00:00.000Z'),
        contractTotalAmount: 1_200,
        contractBaseRemainingAmount: 1_200,
        contractFinalAmount: 1_200,
        contractMonthlyPayment: 1_200,
        contractRemainingAmount: 1_200,
        createdAt: new Date('2026-02-02T00:00:00.000Z'),
        createdBy: owner.id,
      },
    })
    await prisma.nasiyaSchedule.create({
      data: {
        shopId: shop.id,
        nasiyaId: nasiya.id,
        monthNumber: 1,
        dueDate: new Date('2026-04-10T00:00:00.000Z'),
        delayedUntil: new Date('2026-06-10T00:00:00.000Z'),
        expectedAmount: 1_200,
        contractExpectedAmount: 1_200,
        contractRemainingAmount: 1_200,
        status: 'DEFERRED',
      },
    })

    await expect(getShopReportDataMonths(shop.id, new Date('2026-06-14T12:00:00.000Z')))
      .resolves.toEqual(['2026-06', '2026-05', '2026-04', '2026-03', '2026-02'])
  })

  it.each(['sale', 'nasiya'] as const)(
    'marks a legacy USD %s payment incomplete when every reconstruction field is null',
    async (kind) => {
      const { owner, shop, customer, device } = await seedBase()

      if (kind === 'sale') {
        const sold = await device(625_000, 'SOLD_CASH')
        const sale = await prisma.sale.create({
          data: {
            shopId: shop.id,
            deviceId: sold.id,
            customerId: customer.id,
            salePrice: 1_250_000,
            amountPaid: 1_250_000,
            remainingAmount: 0,
            contractCurrency: 'USD',
            contractExchangeRateAtCreation: 12_500,
            contractSalePrice: 100,
            contractAmountPaid: 100,
            contractRemainingAmount: 0,
            paymentMethod: 'CASH',
            paidFully: true,
            createdAt: new Date('2026-03-05T00:00:00.000Z'),
            createdBy: owner.id,
          },
        })
        await prisma.salePayment.create({
          data: {
            shopId: shop.id,
            saleId: sale.id,
            amount: 1_250_000,
            paymentMethod: 'CASH',
            paidAt: new Date('2026-03-05T00:00:00.000Z'),
            createdBy: owner.id,
          },
        })
      } else {
        const sold = await device(625_000, 'SOLD_NASIYA')
        const nasiya = await prisma.nasiya.create({
          data: {
            shopId: shop.id,
            deviceId: sold.id,
            customerId: customer.id,
            totalAmount: 1_250_000,
            downPayment: 0,
            baseRemainingAmount: 1_250_000,
            interestAmount: 0,
            finalNasiyaAmount: 1_250_000,
            remainingAmount: 625_000,
            months: 1,
            monthlyPayment: 1_250_000,
            startDate: new Date('2026-03-01T00:00:00.000Z'),
            contractCurrency: 'USD',
            contractExchangeRateAtCreation: 12_500,
            contractTotalAmount: 100,
            contractBaseRemainingAmount: 100,
            contractFinalAmount: 100,
            contractMonthlyPayment: 100,
            contractPaidAmount: 50,
            contractRemainingAmount: 50,
            createdAt: new Date('2026-03-06T00:00:00.000Z'),
            createdBy: owner.id,
          },
        })
        const schedule = await prisma.nasiyaSchedule.create({
          data: {
            shopId: shop.id,
            nasiyaId: nasiya.id,
            monthNumber: 1,
            dueDate: new Date('2026-04-06T00:00:00.000Z'),
            expectedAmount: 1_250_000,
            paidAmount: 625_000,
            status: 'PARTIAL',
            contractCurrency: 'USD',
            contractExpectedAmount: 100,
            contractPaidAmount: 50,
            contractRemainingAmount: 50,
          },
        })
        await prisma.nasiyaPayment.create({
          data: {
            shopId: shop.id,
            nasiyaId: nasiya.id,
            nasiyaScheduleId: schedule.id,
            amount: 625_000,
            paymentMethod: 'CASH',
            paidAt: new Date('2026-03-06T00:00:00.000Z'),
            createdBy: owner.id,
          },
        })
      }

      const range = resolveReportRange({ preset: 'single', month: '2026-03', defaultEndMonth: '2026-03' })
      const report = await getShopRangeReport({ shopId: shop.id, range, adminId: null })

      expect(report.months[0].cashCollected).toEqual({ uzs: 0, usd: 0, complete: false })
      expect(report.totals.cashCollected).toEqual({ uzs: 0, usd: 0, complete: false })
    },
  )

  it('zero-fills explicit ranges, preserves currencies and excludes imports/write-offs from active expected totals', async () => {
    const { owner, shop, customer, device } = await seedBase()
    const otherActor = 'other-admin'

    const saleDevice = await device(600, 'SOLD_CASH')
    const sale = await prisma.sale.create({
      data: {
        shopId: shop.id,
        deviceId: saleDevice.id,
        customerId: customer.id,
        salePrice: 1_000,
        amountPaid: 500,
        remainingAmount: 500,
        contractSalePrice: 1_000,
        contractAmountPaid: 500,
        contractRemainingAmount: 500,
        paymentMethod: 'CASH',
        paidFully: false,
        dueDate: new Date('2026-03-10T00:00:00.000Z'),
        createdAt: new Date('2026-01-10T00:00:00.000Z'),
        createdBy: owner.id,
      },
    })
    await prisma.salePayment.create({
      data: {
        shopId: shop.id,
        saleId: sale.id,
        amount: 500,
        appliedAmountInContractCurrency: 500,
        paymentMethod: 'CASH',
        paidAt: new Date('2026-01-10T00:00:00.000Z'),
        createdBy: owner.id,
      },
    })

    const usdDevice = await device(1_000_000, 'SOLD_CASH')
    const usdSale = await prisma.sale.create({
      data: {
        shopId: shop.id,
        deviceId: usdDevice.id,
        customerId: customer.id,
        salePrice: 2_500_000,
        amountPaid: 625_000,
        remainingAmount: 1_875_000,
        contractCurrency: 'USD',
        contractExchangeRateAtCreation: 12_500,
        contractSalePrice: 200,
        contractAmountPaid: 50,
        contractRemainingAmount: 150,
        paymentMethod: 'CARD',
        paidFully: false,
        dueDate: new Date('2026-03-11T00:00:00.000Z'),
        createdAt: new Date('2026-02-10T00:00:00.000Z'),
        createdBy: otherActor,
      },
    })
    await prisma.salePayment.create({
      data: {
        shopId: shop.id,
        saleId: usdSale.id,
        amount: 625_000,
        paymentInputAmount: 50,
        paymentInputCurrency: 'USD',
        paymentExchangeRate: 12_500,
        appliedAmountInContractCurrency: 50,
        paymentMethod: 'CARD',
        paidAt: new Date('2026-02-10T00:00:00.000Z'),
        createdBy: otherActor,
      },
    })

    const archivedDevice = await device(300, 'SOLD_NASIYA')
    const archived = await prisma.nasiya.create({
      data: {
        shopId: shop.id,
        deviceId: archivedDevice.id,
        customerId: customer.id,
        totalAmount: 900,
        downPayment: 0,
        baseRemainingAmount: 900,
        interestAmount: 90,
        finalNasiyaAmount: 990,
        remainingAmount: 990,
        months: 1,
        monthlyPayment: 990,
        startDate: new Date('2026-02-01T00:00:00.000Z'),
        resolutionState: 'ARCHIVED',
        contractTotalAmount: 900,
        contractBaseRemainingAmount: 900,
        contractInterestAmount: 90,
        contractFinalAmount: 990,
        contractMonthlyPayment: 990,
        contractRemainingAmount: 990,
        createdAt: new Date('2026-02-12T00:00:00.000Z'),
        createdBy: owner.id,
      },
    })
    await prisma.nasiyaSchedule.create({
      data: {
        shopId: shop.id,
        nasiyaId: archived.id,
        monthNumber: 1,
        dueDate: new Date('2026-03-15T00:00:00.000Z'),
        expectedAmount: 990,
        contractExpectedAmount: 990,
        contractRemainingAmount: 990,
      },
    })

    const writtenDevice = await device(400, 'SOLD_NASIYA')
    const written = await prisma.nasiya.create({
      data: {
        shopId: shop.id,
        deviceId: writtenDevice.id,
        customerId: customer.id,
        totalAmount: 1_200,
        downPayment: 0,
        baseRemainingAmount: 1_200,
        interestAmount: 0,
        finalNasiyaAmount: 1_200,
        remainingAmount: 1_200,
        months: 1,
        monthlyPayment: 1_200,
        startDate: new Date('2026-02-01T00:00:00.000Z'),
        resolutionState: 'WRITTEN_OFF',
        contractTotalAmount: 1_200,
        contractBaseRemainingAmount: 1_200,
        contractFinalAmount: 1_200,
        contractMonthlyPayment: 1_200,
        contractRemainingAmount: 1_200,
        createdAt: new Date('2026-02-15T00:00:00.000Z'),
        createdBy: owner.id,
      },
    })
    await prisma.nasiyaSchedule.create({
      data: {
        shopId: shop.id,
        nasiyaId: written.id,
        monthNumber: 1,
        dueDate: new Date('2026-03-16T00:00:00.000Z'),
        expectedAmount: 1_200,
        contractExpectedAmount: 1_200,
        contractRemainingAmount: 1_200,
      },
    })
    await prisma.nasiyaResolutionEvent.create({
      data: {
        shopId: shop.id,
        nasiyaId: written.id,
        eventType: 'WRITE_OFF',
        previousState: 'ACTIVE',
        newState: 'WRITTEN_OFF',
        contractCurrency: 'UZS',
        nativeRemainingAmount: 1_200,
        frozenUzsAmount: 1_200,
        frozenUsdUzsRate: 12_500,
        reason: 'Customer cannot be contacted',
        actorId: owner.id,
        actorType: 'SUPER_ADMIN',
        idempotencyKey: 'report-write-off',
        createdAt: new Date('2026-03-20T00:00:00.000Z'),
      },
    })

    const importedDevice = await device(1, 'SOLD_NASIYA')
    await prisma.nasiya.create({
      data: {
        shopId: shop.id,
        deviceId: importedDevice.id,
        customerId: customer.id,
        totalAmount: 10_000,
        downPayment: 0,
        baseRemainingAmount: 10_000,
        interestAmount: 0,
        finalNasiyaAmount: 10_000,
        remainingAmount: 10_000,
        months: 1,
        monthlyPayment: 10_000,
        startDate: new Date('2026-02-01T00:00:00.000Z'),
        isImported: true,
        originalTotalAmount: 10_000,
        alreadyPaidBeforeImport: 0,
        remainingAtImport: 10_000,
        contractTotalAmount: 10_000,
        contractBaseRemainingAmount: 10_000,
        contractFinalAmount: 10_000,
        contractMonthlyPayment: 10_000,
        contractRemainingAmount: 10_000,
        createdAt: new Date('2026-02-18T00:00:00.000Z'),
        createdBy: owner.id,
      },
    })

    const range = resolveReportRange({
      preset: 'custom',
      startMonth: '2026-01',
      endMonth: '2026-03',
      defaultEndMonth: '2026-03',
    })
    const report = await getShopRangeReport({ shopId: shop.id, range, adminId: null })

    expect(report.months.map((month) => month.monthKey)).toEqual(['2026-01', '2026-02', '2026-03'])
    expect(report.months[0]).toMatchObject({
      cashCollected: { uzs: 500, usd: 0, complete: true },
      accrualRevenue: { uzs: 1_000, usd: 0 },
      grossProfitUzs: 400,
    })
    expect(report.months[1]).toMatchObject({
      cashCollected: { uzs: 0, usd: 50, complete: true },
      accrualRevenue: { uzs: 1_200, usd: 200 },
      nasiyaInterest: { uzs: 0, usd: 0 },
    })
    expect(report.months[2]).toMatchObject({
      expectedReceivables: { uzs: 500, usd: 150 },
      writeOffs: { uzs: 1_200, usd: 0, frozenUzs: 1_200 },
      writeOffCount: 1,
    })
    expect(report.totals.accrualRevenue).toEqual({ uzs: 2_200, usd: 200 })

    const ownerOnly = await getShopRangeReport({ shopId: shop.id, range, adminId: owner.id })
    expect(ownerOnly.totals.cashCollected).toEqual({ uzs: 500, usd: 0, complete: true })
    // Expected debt has no single attributable actor and deliberately remains shop-wide.
    expect(ownerOnly.months[2].expectedReceivables).toEqual({ uzs: 500, usd: 150 })
  })
})
