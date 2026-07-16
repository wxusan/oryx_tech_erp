import { execFileSync } from 'node:child_process'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@/generated/prisma/client'

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL
if (!databaseUrl) throw new Error('TEST_DATABASE_URL or DATABASE_URL is required')

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl, max: 4 }) })

beforeEach(async () => {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "ReminderGenerationState", "AuthSession", "ChangeEvent", "OpsEvent", "Log", "Notification", "DeviceReturn",
      "NasiyaResolutionEvent", "NasiyaDeferral", "NasiyaPayment", "NasiyaSchedule", "Nasiya",
      "SupplierPayable", "SalePayment", "Sale", "Customer", "Device",
      "Supplier", "ShopAdmin", "ShopPayment", "CurrencyRate", "Shop", "SuperAdmin"
    RESTART IDENTITY CASCADE
  `)
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('historical payment-profit backfill', () => {
  it('replays reliable receipts exactly, remains idempotent, and marks imports as unreconstructable', async () => {
    const owner = await prisma.superAdmin.create({
      data: { name: 'Backfill owner', login: 'backfill-owner', passwordHash: 'integration-only' },
    })
    const shop = await prisma.shop.create({
      data: {
        name: 'Backfill shop',
        ownerName: owner.name,
        ownerPhone: '+998901010101',
        shopNumber: 'BACKFILL',
        address: 'Disposable database',
        subscriptionDue: new Date('2099-01-01T00:00:00.000Z'),
        createdById: owner.id,
      },
    })
    const customer = await prisma.customer.create({
      data: {
        shopId: shop.id,
        name: 'Backfill customer',
        phone: '+998909090909',
        normalizedPhone: '998909090909',
      },
    })
    const device = await prisma.device.create({
      data: {
        shopId: shop.id,
        model: 'Reliable legacy contract',
        purchasePrice: 800,
        purchaseCurrency: 'UZS',
        purchaseInputAmount: 800,
        purchaseAmountUzsSnapshot: 800,
        imei: 'BACKFILL-RELIABLE',
        status: 'SOLD_NASIYA',
        addedBy: owner.id,
      },
    })
    const { nasiya, schedules } = await prisma.$transaction(async (tx) => {
      const nasiya = await tx.nasiya.create({
      data: {
        shopId: shop.id,
        deviceId: device.id,
        customerId: customer.id,
        totalAmount: 1_000,
        downPayment: 200,
        baseRemainingAmount: 800,
        interestPercent: 20,
        interestAmount: 160,
        finalNasiyaAmount: 960,
        remainingAmount: 720,
        months: 4,
        monthlyPayment: 240,
        startDate: new Date('2026-07-01T00:00:00.000Z'),
        contractCurrency: 'UZS',
        contractTotalAmount: 1_000,
        contractDownPayment: 200,
        contractBaseRemainingAmount: 800,
        contractInterestAmount: 160,
        contractFinalAmount: 960,
        contractMonthlyPayment: 240,
        contractPaidAmount: 240,
        contractRemainingAmount: 720,
        createdAt: new Date('2026-07-15T08:00:00.000Z'),
        createdBy: owner.id,
      },
    })
      const schedules = []
      for (let monthNumber = 1; monthNumber <= 4; monthNumber += 1) {
        schedules.push(await tx.nasiyaSchedule.create({
        data: {
          shopId: shop.id,
          nasiyaId: nasiya.id,
          monthNumber,
          dueDate: new Date(`2026-${String(7 + monthNumber).padStart(2, '0')}-01T00:00:00.000Z`),
          expectedAmount: 240,
          paidAmount: monthNumber === 1 ? 240 : 0,
          status: monthNumber === 1 ? 'PAID' : 'PENDING',
          paidAt: monthNumber === 1 ? new Date('2026-08-10T08:00:00.000Z') : null,
          contractCurrency: 'UZS',
          contractExpectedAmount: 240,
          contractPaidAmount: monthNumber === 1 ? 240 : 0,
          contractRemainingAmount: monthNumber === 1 ? 0 : 240,
        },
        }))
      }
      return { nasiya, schedules }
    })
    const downPayment = await prisma.nasiyaPayment.create({
      data: {
        shopId: shop.id,
        nasiyaId: nasiya.id,
        amount: 200,
        appliedAmountInContractCurrency: 200,
        paymentMethod: 'CASH',
        note: "Boshlang'ich to'lov",
        paidAt: new Date('2026-07-15T08:00:00.000Z'),
        createdAt: new Date('2026-07-15T08:00:00.000Z'),
        createdBy: owner.id,
      },
    })
    const installment = await prisma.nasiyaPayment.create({
      data: {
        shopId: shop.id,
        nasiyaId: nasiya.id,
        nasiyaScheduleId: schedules[0].id,
        amount: 240,
        appliedAmountInContractCurrency: 240,
        paymentMethod: 'CASH',
        paidAt: new Date('2026-08-10T08:00:00.000Z'),
        createdAt: new Date('2026-08-10T08:00:00.000Z'),
        createdBy: owner.id,
      },
    })

    const importedDevice = await prisma.device.create({
      data: {
        shopId: shop.id,
        model: 'Imported unknown-cost contract',
        purchasePrice: 0,
        purchaseInputAmount: 0,
        purchaseAmountUzsSnapshot: 0,
        imei: 'BACKFILL-IMPORTED',
        status: 'SOLD_NASIYA',
        isImported: true,
        addedBy: owner.id,
      },
    })
    const imported = await prisma.$transaction(async (tx) => {
      const imported = await tx.nasiya.create({
      data: {
        shopId: shop.id,
        deviceId: importedDevice.id,
        customerId: customer.id,
        totalAmount: 500,
        downPayment: 0,
        baseRemainingAmount: 500,
        finalNasiyaAmount: 500,
        remainingAmount: 500,
        months: 1,
        monthlyPayment: 500,
        startDate: new Date('2026-07-01T00:00:00.000Z'),
        contractTotalAmount: 500,
        contractBaseRemainingAmount: 500,
        contractFinalAmount: 500,
        contractMonthlyPayment: 500,
        contractRemainingAmount: 500,
        isImported: true,
        importSource: 'MANUAL',
        originalTotalAmount: 500,
        remainingAtImport: 500,
        createdBy: owner.id,
      },
      })
      await tx.nasiyaSchedule.create({
        data: {
          nasiyaId: imported.id,
          shopId: shop.id,
          monthNumber: 1,
          dueDate: new Date('2026-08-01T00:00:00.000Z'),
          expectedAmount: 500,
          contractExpectedAmount: 500,
          contractRemainingAmount: 500,
        },
      })
      return imported
    })

    const runBackfill = () => execFileSync(process.execPath, [
      'scripts/backfill-payment-profit-ledger.mjs',
      '--apply',
      `--shop-id=${shop.id}`,
    ], {
      cwd: process.cwd(),
      env: { ...process.env, DIRECT_URL: databaseUrl, DATABASE_URL: databaseUrl },
      encoding: 'utf8',
    })

    expect(JSON.parse(runBackfill())).toMatchObject({
      mode: 'apply',
      nasiyas: { complete: 1, partial: 0, unreconstructable: 1 },
    })

    const [reconstructed, importedAfter, allocations, originalPayments] = await Promise.all([
      prisma.nasiya.findUniqueOrThrow({
        where: { id: nasiya.id },
        include: { schedules: { orderBy: { monthNumber: 'asc' } } },
      }),
      prisma.nasiya.findUniqueOrThrow({ where: { id: imported.id } }),
      prisma.nasiyaPaymentAllocation.findMany({
        where: { nasiyaId: nasiya.id },
        orderBy: [{ createdAt: 'asc' }, { sequence: 'asc' }],
      }),
      prisma.nasiyaPayment.findMany({ where: { id: { in: [downPayment.id, installment.id] } } }),
    ])
    expect(reconstructed.accountingReconstructionStatus).toBe('COMPLETE')
    expect(Number(reconstructed.contractCostBasisAmount)).toBe(800)
    expect(Number(reconstructed.contractMarginAmount)).toBe(200)
    expect(reconstructed.schedules.map((schedule) => ({
      principal: Number(schedule.contractPrincipalAmount),
      margin: Number(schedule.contractMarginAmount),
      interest: Number(schedule.contractInterestAmount),
    }))).toEqual(Array.from({ length: 4 }, () => ({ principal: 160, margin: 40, interest: 40 })))
    expect(allocations.map((allocation) => ({
      scheduleId: allocation.nasiyaScheduleId,
      principal: Number(allocation.contractPrincipalAmount),
      margin: Number(allocation.contractMarginAmount),
      interest: Number(allocation.contractInterestAmount),
    }))).toEqual([
      { scheduleId: null, principal: 160, margin: 40, interest: 0 },
      { scheduleId: schedules[0].id, principal: 160, margin: 40, interest: 40 },
    ])
    expect(originalPayments).toHaveLength(2)
    expect(importedAfter.accountingReconstructionStatus).toBe('UNRECONSTRUCTABLE')
    expect(importedAfter.accountingReconstructionReason).toContain('pre-Oryx import')

    expect(JSON.parse(runBackfill())).toMatchObject({
      nasiyas: { complete: 0, partial: 0, unreconstructable: 0 },
    })
    await expect(prisma.nasiyaPaymentAllocation.count({ where: { nasiyaId: nasiya.id } })).resolves.toBe(2)
  })
})
