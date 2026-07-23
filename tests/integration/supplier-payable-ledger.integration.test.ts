import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@/generated/prisma/client'
import { queryIncomingPayLaterDebts, queryOutgoingDebts } from '@/lib/server/debts'
import { getShopDebtStatsAggregate } from '@/lib/server/shop-stats-queries'
import { resolvePrivateUploadReference } from '@/lib/server/private-upload-reference'

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL
if (!databaseUrl) throw new Error('TEST_DATABASE_URL or DATABASE_URL is required')
const privateUploadSecret = process.env.AUTH_SECRET
  || process.env.NEXTAUTH_SECRET
  || 'integration-private-upload-secret-at-least-32-characters'
process.env.AUTH_SECRET = privateUploadSecret

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl, max: 2 }) })

async function resetBusinessData() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "ChangeEvent", "Log", "Notification", "SupplierPayablePayment",
      "SupplierPayable", "OlibSotdimOperation", "NasiyaPaymentAllocation",
      "NasiyaPayment", "NasiyaSchedule", "Nasiya", "SalePayment", "Sale",
      "Customer", "DeviceImei", "Device", "Supplier", "ShopAdmin",
      "ShopPayment", "Shop", "SuperAdmin"
    RESTART IDENTITY CASCADE
  `)
}

async function seedDevice(suffix: string) {
  const root = await prisma.superAdmin.create({
    data: { name: `Root ${suffix}`, login: `root_${suffix}`, passwordHash: 'integration-only' },
  })
  const shop = await prisma.shop.create({
    data: {
      name: `Ledger shop ${suffix}`,
      ownerName: 'Owner',
      ownerPhone: `+99890${suffix.padStart(7, '0').slice(-7)}`,
      shopNumber: `ledger-${suffix}`,
      address: 'Integration test',
      subscriptionDue: new Date('2099-01-01T00:00:00.000Z'),
      createdById: root.id,
    },
  })
  const device = await prisma.device.create({
    data: {
      shopId: shop.id,
      model: `Phone ${suffix}`,
      purchasePrice: 1_000_000,
      purchaseInputAmount: 1_000_000,
      purchaseAmountUzsSnapshot: 1_000_000,
      imei: `ledger-imei-${suffix}`,
      addedBy: root.id,
    },
  })
  return { root, shop, device }
}

beforeEach(resetBusinessData)
afterAll(() => prisma.$disconnect())

describe('supplier payable append-only ledger invariants', () => {
  it('accepts a reconciled partial payment and rejects evidence mutation, duplicate idempotency, and cross-tenant links', async () => {
    const first = await seedDevice('1')
    const second = await seedDevice('2')
    const payable = await prisma.supplierPayable.create({
      data: {
        shopId: first.shop.id,
        deviceId: first.device.id,
        origin: 'DEVICE_PURCHASE',
        supplierName: 'Ali',
        supplierPhone: '+998901111111',
        amount: 1_000_000,
        contractAmount: 1_000_000,
        remainingAmount: 1_000_000,
        contractRemainingAmount: 1_000_000,
        dueDate: new Date('2026-08-01T00:00:00.000Z'),
        createdBy: first.root.id,
        creationIdempotencyKey: 'ledger-create-1',
        creationCommandHash: 'hash-create-1',
      },
    })

    const payment = await prisma.$transaction(async (tx) => {
      const row = await tx.supplierPayablePayment.create({
        data: {
          shopId: first.shop.id,
          supplierPayableId: payable.id,
          amount: 250_000,
          paymentInputAmount: 250_000,
          paymentInputCurrency: 'UZS',
          appliedAmountInContractCurrency: 250_000,
          paymentMethod: 'CASH',
          paidAt: new Date('2026-07-20T00:00:00.000Z'),
          createdBy: first.root.id,
          idempotencyKey: 'ledger-payment-1',
          commandHash: 'hash-payment-1',
        },
      })
      await tx.supplierPayable.update({
        where: { id: payable.id },
        data: {
          paidAmount: 250_000,
          remainingAmount: 750_000,
          contractPaidAmount: 250_000,
          contractRemainingAmount: 750_000,
          status: 'PARTIAL',
          ledgerVersion: { increment: 1 },
          lastPaymentAt: new Date('2026-07-20T00:00:00.000Z'),
        },
      })
      return row
    })

    const current = await prisma.supplierPayable.findUniqueOrThrow({ where: { id: payable.id } })
    expect(Number(current.contractRemainingAmount)).toBe(750_000)
    expect(current.status).toBe('PARTIAL')
    await expect(prisma.supplierPayablePayment.update({
      where: { id: payment.id },
      data: { note: 'rewrite' },
    })).rejects.toThrow(/append-only/)
    await expect(prisma.supplierPayablePayment.delete({ where: { id: payment.id } })).rejects.toThrow(/append-only/)
    await expect(prisma.supplierPayablePayment.create({
      data: {
        shopId: first.shop.id,
        supplierPayableId: payable.id,
        amount: 1,
        paymentInputAmount: 1,
        paymentInputCurrency: 'UZS',
        appliedAmountInContractCurrency: 1,
        paymentMethod: 'CASH',
        createdBy: first.root.id,
        idempotencyKey: 'ledger-payment-1',
        commandHash: 'different',
      },
    })).rejects.toMatchObject({ code: 'P2002' })
    await expect(prisma.supplierPayable.create({
      data: {
        shopId: second.shop.id,
        deviceId: first.device.id,
        origin: 'DEVICE_PURCHASE',
        supplierName: 'Wrong tenant',
        supplierPhone: '+998902222222',
        amount: 1,
        contractAmount: 1,
        remainingAmount: 1,
        contractRemainingAmount: 1,
        dueDate: new Date('2026-08-01T00:00:00.000Z'),
        createdBy: second.root.id,
      },
    })).rejects.toMatchObject({ code: 'P2003' })
  })

  it('emits supplier-payable change metadata into every independently authorized cache domain', async () => {
    const actor = await seedDevice('3')
    const payable = await prisma.supplierPayable.create({
      data: {
        shopId: actor.shop.id,
        deviceId: actor.device.id,
        origin: 'DEVICE_PURCHASE',
        supplierName: 'Aziz',
        supplierPhone: '+998903333333',
        amount: 500_000,
        contractAmount: 500_000,
        remainingAmount: 500_000,
        contractRemainingAmount: 500_000,
        dueDate: new Date('2026-08-01T00:00:00.000Z'),
        createdBy: actor.root.id,
      },
    })
    await prisma.log.create({
      data: {
        shopId: actor.shop.id,
        actorId: actor.root.id,
        actorType: 'SUPER_ADMIN',
        action: 'CREATE_SUPPLIER_PAYABLE',
        targetType: 'SupplierPayable',
        targetId: payable.id,
      },
    })
    const events = await prisma.changeEvent.findMany({
      where: { scopeType: 'SHOP', scopeId: actor.shop.id, entityType: 'SupplierPayable', entityId: payable.id },
      orderBy: { domain: 'asc' },
      select: { domain: true, operation: true },
    })
    expect(events.map((row) => row.domain)).toEqual(['debts', 'devices', 'logs', 'olibSotdim', 'payments', 'reports'])
    expect(events.every((row) => row.operation === 'created')).toBe(true)
  })

  it('keeps both Qarz tabs tenant-scoped, due-month scoped, keyset bounded, and excludes Nasiya from incoming Pay Later', async () => {
    const first = await seedDevice('4')
    const second = await seedDevice('5')
    const createPayable = async (input: { shopId: string; deviceId: string; key: string; dueDate: Date; paid?: number }) => {
      const payable = await prisma.supplierPayable.create({
        data: {
          shopId: input.shopId,
          deviceId: input.deviceId,
          origin: 'DEVICE_PURCHASE',
          supplierName: `Supplier ${input.key}`,
          supplierPhone: '+998904444444',
          amount: 1_000_000,
          contractAmount: 1_000_000,
          remainingAmount: 1_000_000,
          contractRemainingAmount: 1_000_000,
          status: 'PENDING',
          dueDate: input.dueDate,
          createdBy: 'integration',
          creationIdempotencyKey: `query-${input.key}`,
          creationCommandHash: `hash-${input.key}`,
        },
      })
      if (!input.paid) return payable
      return prisma.$transaction(async (tx) => {
        await tx.supplierPayablePayment.create({
          data: {
            shopId: input.shopId,
            supplierPayableId: payable.id,
            amount: input.paid!,
            paymentInputAmount: input.paid!,
            paymentInputCurrency: 'UZS',
            appliedAmountInContractCurrency: input.paid!,
            paymentMethod: 'CASH',
            createdBy: 'integration',
            idempotencyKey: `query-payment-${input.key}`,
            commandHash: `query-payment-hash-${input.key}`,
          },
        })
        return tx.supplierPayable.update({
          where: { id: payable.id },
          data: {
            paidAmount: input.paid!,
            remainingAmount: 1_000_000 - input.paid!,
            contractPaidAmount: input.paid!,
            contractRemainingAmount: 1_000_000 - input.paid!,
            status: 'PARTIAL',
            ledgerVersion: { increment: 1 },
            lastPaymentAt: new Date('2026-07-20T00:00:00.000Z'),
          },
        })
      })
    }
    await createPayable({ shopId: first.shop.id, deviceId: first.device.id, key: 'aug-a', dueDate: new Date('2026-08-10T00:00:00.000Z') })
    const outgoingImageKeys = Array.from(
      { length: 12 },
      (_, index) => `shops/${first.shop.id}/devices/outgoing-${String(index + 1).padStart(2, '0')}.jpg`,
    )
    await prisma.device.update({
      where: { id: first.device.id },
      data: {
        imageUrls: [
          ...outgoingImageKeys,
          `shops/${second.shop.id}/devices/foreign.jpg`,
          'https://example.com/legacy.jpg',
        ],
      },
    })
    const secondDevice = await prisma.device.create({
      data: { shopId: first.shop.id, model: 'Second debt phone', purchasePrice: 1, imei: 'ledger-query-second', addedBy: first.root.id },
    })
    await createPayable({ shopId: first.shop.id, deviceId: secondDevice.id, key: 'aug-b', dueDate: new Date('2026-08-20T00:00:00.000Z'), paid: 200_000 })
    const septemberDevice = await prisma.device.create({
      data: { shopId: first.shop.id, model: 'September debt phone', purchasePrice: 1, imei: 'ledger-query-september', addedBy: first.root.id },
    })
    await createPayable({ shopId: first.shop.id, deviceId: septemberDevice.id, key: 'sep-a', dueDate: new Date('2026-09-05T00:00:00.000Z') })
    await createPayable({ shopId: second.shop.id, deviceId: second.device.id, key: 'foreign', dueDate: new Date('2026-08-05T00:00:00.000Z') })

    const outgoingFirst = await queryOutgoingDebts(first.shop.id, { month: '2026-08', status: 'ALL', take: 1 })
    expect(outgoingFirst.items).toHaveLength(1)
    expect(outgoingFirst.nextCursor).toBeTruthy()
    expect(outgoingFirst.items[0].device.imageUrls).toHaveLength(10)
    expect(outgoingFirst.items[0].device.imageUrls.every((url) => url.startsWith('/api/uploads/device?reference=v1.'))).toBe(true)
    expect(JSON.stringify(outgoingFirst.items[0].device.imageUrls)).not.toContain('shops/')
    expect(outgoingFirst.items[0].device.imageUrls.map((url) => resolvePrivateUploadReference({
      value: url,
      shopId: first.shop.id,
      kind: 'device',
      secret: privateUploadSecret,
    }))).toEqual(outgoingImageKeys.slice(0, 10))
    const outgoingSecond = await queryOutgoingDebts(first.shop.id, { month: '2026-08', status: 'ALL', take: 1, cursor: outgoingFirst.nextCursor! })
    expect(outgoingSecond.items).toHaveLength(1)
    expect(new Set([...outgoingFirst.items, ...outgoingSecond.items].map((item) => item.supplier.name))).toEqual(new Set(['Supplier aug-a', 'Supplier aug-b']))
    expect((await queryOutgoingDebts(first.shop.id, { month: '2026-08', status: 'PARTIAL' })).items).toHaveLength(1)
    expect((await queryOutgoingDebts(first.shop.id, { month: '2026-09', status: 'ALL' })).items).toHaveLength(1)
    expect((await queryOutgoingDebts(first.shop.id, { month: 'ALL', status: 'ALL' })).items).toHaveLength(3)
    const debtStats = await getShopDebtStatsAggregate({
      shopId: first.shop.id,
      monthStart: new Date('2026-08-01T00:00:00.000Z'),
      monthEnd: new Date('2026-09-01T00:00:00.000Z'),
      todayStart: new Date('2026-07-20T00:00:00.000Z'),
      adminId: null,
    })
    expect(debtStats.supplierPayablesOpenAllTimeUzs).toBe(2_800_000)
    expect(debtStats.supplierPayablesOpenAllTimeCount).toBe(3)
    expect(debtStats.supplierPayablesDueSelectedMonthUzs).toBe(1_800_000)
    expect(debtStats.supplierPayablesDueSelectedMonthCount).toBe(2)

    const customer = await prisma.customer.create({
      data: { shopId: first.shop.id, name: 'Pay Later customer', phone: '+998905555555', normalizedPhone: '998905555555' },
    })
    const saleDevice = await prisma.device.create({
      data: {
        shopId: first.shop.id,
        model: 'Sale debt phone',
        purchasePrice: 500_000,
        imei: 'ledger-query-sale',
        addedBy: first.root.id,
        status: 'SOLD_DEBT',
        imageUrls: [
          `shops/${first.shop.id}/devices/incoming-01.webp`,
          `shops/${first.shop.id}/devices/incoming-02.webp`,
          `shops/${second.shop.id}/devices/foreign.webp`,
        ],
      },
    })
    await prisma.sale.create({
      data: {
        shopId: first.shop.id,
        deviceId: saleDevice.id,
        customerId: customer.id,
        salePrice: 1_000_000,
        amountPaid: 0,
        remainingAmount: 1_000_000,
        paidFully: false,
        dueDate: new Date('2026-08-15T00:00:00.000Z'),
        contractSalePrice: 1_000_000,
        contractAmountPaid: 0,
        contractRemainingAmount: 1_000_000,
        createdBy: first.root.id,
      },
    })
    const nasiyaDevice = await prisma.device.create({
      data: { shopId: first.shop.id, model: 'Nasiya phone', purchasePrice: 500_000, imei: 'ledger-query-nasiya', addedBy: first.root.id, status: 'SOLD_NASIYA' },
    })
    await prisma.$transaction(async (tx) => {
      const nasiya = await tx.nasiya.create({
        data: {
          shopId: first.shop.id,
          deviceId: nasiyaDevice.id,
          customerId: customer.id,
          totalAmount: 1_000_000,
          downPayment: 0,
          baseRemainingAmount: 1_000_000,
          finalNasiyaAmount: 1_000_000,
          remainingAmount: 1_000_000,
          months: 1,
          monthlyPayment: 1_000_000,
          startDate: new Date('2026-08-01T00:00:00.000Z'),
          contractTotalAmount: 1_000_000,
          contractBaseRemainingAmount: 1_000_000,
          contractFinalAmount: 1_000_000,
          contractMonthlyPayment: 1_000_000,
          contractRemainingAmount: 1_000_000,
          createdBy: first.root.id,
        },
      })
      await tx.nasiyaSchedule.create({
        data: {
          shopId: first.shop.id,
          nasiyaId: nasiya.id,
          monthNumber: 1,
          dueDate: new Date('2026-08-15T00:00:00.000Z'),
          expectedAmount: 1_000_000,
          contractExpectedAmount: 1_000_000,
          contractRemainingAmount: 1_000_000,
        },
      })
    })
    const incoming = await queryIncomingPayLaterDebts(first.shop.id, { month: '2026-08', status: 'ALL' })
    expect(incoming.items).toHaveLength(1)
    expect(incoming.items[0].customer.name).toBe('Pay Later customer')
    expect(incoming.items[0].origin).toBe('ORDINARY_SALE')
    expect(incoming.items[0].device.imageUrls.map((url) => resolvePrivateUploadReference({
      value: url,
      shopId: first.shop.id,
      kind: 'device',
      secret: privateUploadSecret,
    }))).toEqual([
      `shops/${first.shop.id}/devices/incoming-01.webp`,
      `shops/${first.shop.id}/devices/incoming-02.webp`,
    ])
    expect(JSON.stringify(incoming.items[0].device.imageUrls)).not.toContain('shops/')
  })
})
