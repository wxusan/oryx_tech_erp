import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@/generated/prisma/client'

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL
if (!databaseUrl) throw new Error('TEST_DATABASE_URL or DATABASE_URL is required')

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl, max: 6 }) })

async function resetBusinessData() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "ReminderGenerationState", "AuthSession", "ChangeEvent", "OpsEvent", "Log", "Notification", "DeviceReturn",
      "NasiyaDeferral", "NasiyaPayment", "NasiyaSchedule", "Nasiya",
      "SupplierPayable", "SalePayment", "Sale", "Customer", "Device",
      "Supplier", "ShopAdmin", "ShopPayment", "CurrencyRate", "Shop", "SuperAdmin"
    RESTART IDENTITY CASCADE
  `)
}

async function seedShop(suffix: string) {
  const owner = await prisma.superAdmin.create({
    data: { name: `Owner ${suffix}`, login: `owner_${suffix}`, passwordHash: 'audit-only' },
  })
  const shop = await prisma.shop.create({
    data: {
      name: `Shop ${suffix}`,
      ownerName: `Owner ${suffix}`,
      ownerPhone: `+99890${suffix.padStart(7, '0').slice(-7)}`,
      shopNumber: suffix,
      address: 'Disposable audit database',
      subscriptionDue: new Date('2099-01-01T00:00:00.000Z'),
      createdById: owner.id,
    },
  })
  return { owner, shop }
}

async function createCapturedUzsDeviceWithReceipt(input: {
  shopId: string
  actorId: string
  model: string
  imei: string
  amount: number
  status?: 'IN_STOCK' | 'SOLD_CASH' | 'SOLD_DEBT' | 'SOLD_NASIYA'
}) {
  return prisma.$transaction(async (tx) => {
    const device = await tx.device.create({
      data: {
        shopId: input.shopId,
        model: input.model,
        purchasePrice: input.amount,
        purchaseCurrency: 'UZS',
        purchaseInputAmount: input.amount,
        purchaseAmountUzsSnapshot: input.amount,
        imei: input.imei,
        addedBy: input.actorId,
        status: input.status,
        evidenceVersion: 2,
        evidenceStatus: 'CAPTURED',
      },
    })
    const receipt = await tx.devicePurchaseReceipt.create({
      data: {
        shopId: input.shopId,
        deviceId: device.id,
        inputAmount: input.amount,
        inputCurrency: 'UZS',
        nativeAmount: input.amount,
        nativeCurrency: 'UZS',
        amountUzsSnapshot: input.amount,
        paymentMethod: 'CASH',
        actorId: input.actorId,
        actorType: 'SUPER_ADMIN',
        idempotencyKey: `test-acquisition:${input.imei}`,
        commandHash: 'd'.repeat(64),
        evidenceVersion: 2,
        evidenceStatus: 'CAPTURED',
      },
    })
    return { device, receipt }
  })
}

async function seedSale(
  suffix: string,
  shopId: string,
  actorId: string,
  status: 'IN_STOCK' | 'SOLD_CASH' | 'SOLD_DEBT' | 'SOLD_NASIYA' = 'SOLD_CASH',
) {
  const customer = await prisma.customer.create({
    data: {
      shopId,
      name: `Customer ${suffix}`,
      phone: `+99891${suffix.padStart(7, '0').slice(-7)}`,
      normalizedPhone: `99891${suffix.padStart(7, '0').slice(-7)}`,
    },
  })
  const device = await prisma.device.create({
    data: {
      shopId,
      model: `Device ${suffix}`,
      purchasePrice: 600,
      purchaseInputAmount: 600,
      purchaseAmountUzsSnapshot: 600,
      imei: `AUDIT-${suffix}`,
      addedBy: actorId,
      status,
    },
  })
  const sale = await prisma.sale.create({
    data: {
      shopId,
      deviceId: device.id,
      customerId: customer.id,
      salePrice: 1_000,
      amountPaid: 1_000,
      remainingAmount: 0,
      contractSalePrice: 1_000,
      contractAmountPaid: 1_000,
      contractRemainingAmount: 0,
      paymentMethod: 'CASH',
      paidFully: true,
      createdBy: actorId,
    },
  })
  return { customer, device, sale }
}

beforeEach(resetBusinessData)

afterAll(async () => {
  await prisma.$disconnect()
})

describe('adversarial monetary database invariants', () => {
  it('rejects contradictory Sale ledgers and a negative exchange rate at the database boundary', async () => {
    const { owner, shop } = await seedShop('money_checks')
    const customer = await prisma.customer.create({
      data: { shopId: shop.id, name: 'Equation customer', phone: '+998901010101', normalizedPhone: '998901010101' },
    })
    const device = await prisma.device.create({
      data: { shopId: shop.id, model: 'Equation phone', purchasePrice: 100, imei: 'AUDIT-EQUATION', addedBy: owner.id },
    })

    await expect(prisma.sale.create({
      data: {
        shopId: shop.id,
        deviceId: device.id,
        customerId: customer.id,
        salePrice: 1_000,
        amountPaid: 900,
        remainingAmount: 900,
        contractCurrency: 'USD',
        contractSalePrice: 100,
        contractAmountPaid: 90,
        contractRemainingAmount: 90,
        paymentMethod: 'CASH',
        paidFully: true,
        createdBy: owner.id,
      },
    })).rejects.toThrow()

    await expect(prisma.currencyRate.create({
      data: { baseCurrency: 'USD', quoteCurrency: 'UZS', rate: -1, source: 'AUDIT', fetchedAt: new Date() },
    })).rejects.toThrow()

    expect(await prisma.sale.count({ where: { shopId: shop.id } })).toBe(0)
    expect(await prisma.currencyRate.count()).toBe(0)
  })

  it('requires a schedule remainder and currency that match its parent contract', async () => {
    const { owner, shop } = await seedShop('schedule_checks')
    const { customer, device } = await seedSale('schedule_parent', shop.id, owner.id, 'SOLD_NASIYA')
    const { nasiya, schedule } = await prisma.$transaction(async (tx) => {
      const nasiya = await tx.nasiya.create({
      data: {
        shopId: shop.id,
        deviceId: device.id,
        customerId: customer.id,
        totalAmount: 1_000,
        downPayment: 0,
        baseRemainingAmount: 1_000,
        finalNasiyaAmount: 1_000,
        remainingAmount: 1_000,
        months: 1,
        monthlyPayment: 1_000,
        startDate: new Date('2026-07-01T00:00:00.000Z'),
        contractCurrency: 'UZS',
        contractTotalAmount: 1_000,
        contractBaseRemainingAmount: 1_000,
        contractFinalAmount: 1_000,
        contractMonthlyPayment: 1_000,
        contractRemainingAmount: 1_000,
        createdBy: owner.id,
      },
      })
      const schedule = await tx.nasiyaSchedule.create({
        data: {
          nasiyaId: nasiya.id,
          shopId: shop.id,
          monthNumber: 1,
          dueDate: new Date('2026-08-01T00:00:00.000Z'),
          expectedAmount: 1_000,
          contractCurrency: 'UZS',
          contractExpectedAmount: 1_000,
          contractRemainingAmount: 1_000,
        },
      })
      return { nasiya, schedule }
    })
    await expect(prisma.nasiyaSchedule.create({
      data: {
        nasiyaId: nasiya.id,
        shopId: shop.id,
        monthNumber: 1,
        dueDate: new Date('2026-08-01T00:00:00.000Z'),
        expectedAmount: 1_000,
        contractCurrency: 'UZS',
        contractExpectedAmount: 1_000,
      },
    })).rejects.toThrow()

    await expect(prisma.nasiyaSchedule.create({
      data: {
        nasiyaId: nasiya.id,
        shopId: shop.id,
        monthNumber: 1,
        dueDate: new Date('2026-08-01T00:00:00.000Z'),
        expectedAmount: 1_000,
        contractCurrency: 'USD',
        contractExpectedAmount: 100,
        contractRemainingAmount: 100,
      },
    })).rejects.toThrow()

    expect(schedule.contractCurrency).toBe('UZS')
    expect(Number(schedule.contractRemainingAmount)).toBe(1_000)
  })

  it('rejects a NasiyaPayment linked to another contract schedule in the same shop', async () => {
    const { owner, shop } = await seedShop('allocation_fk')

    async function contract(suffix: string) {
      const customer = await prisma.customer.create({
        data: { shopId: shop.id, name: `Customer ${suffix}`, phone: `+99893${suffix}00000`, normalizedPhone: `99893${suffix}00000` },
      })
      const device = await prisma.device.create({
        data: { shopId: shop.id, model: `Phone ${suffix}`, purchasePrice: 100, imei: `AUDIT-ALLOC-${suffix}`, addedBy: owner.id, status: 'SOLD_NASIYA' },
      })
      const { nasiya, schedule } = await prisma.$transaction(async (tx) => {
        const nasiya = await tx.nasiya.create({
        data: {
          shopId: shop.id,
          deviceId: device.id,
          customerId: customer.id,
          totalAmount: 100,
          downPayment: 0,
          baseRemainingAmount: 100,
          finalNasiyaAmount: 100,
          remainingAmount: 100,
          months: 1,
          monthlyPayment: 100,
          startDate: new Date('2026-07-01T00:00:00.000Z'),
          contractTotalAmount: 100,
          contractBaseRemainingAmount: 100,
          contractFinalAmount: 100,
          contractMonthlyPayment: 100,
          contractRemainingAmount: 100,
          createdBy: owner.id,
        },
        })
        const schedule = await tx.nasiyaSchedule.create({
        data: {
          nasiyaId: nasiya.id,
          shopId: shop.id,
          monthNumber: 1,
          dueDate: new Date('2026-08-01T00:00:00.000Z'),
          expectedAmount: 100,
          contractExpectedAmount: 100,
          contractRemainingAmount: 100,
        },
        })
        return { nasiya, schedule }
      })
      return { nasiya, schedule }
    }

    const first = await contract('1')
    const second = await contract('2')
    await expect(prisma.nasiyaPayment.create({
      data: {
        nasiyaId: first.nasiya.id,
        nasiyaScheduleId: second.schedule.id,
        shopId: shop.id,
        amount: 10,
        appliedAmountInContractCurrency: 10,
        paymentMethod: 'CASH',
        createdBy: owner.id,
      },
    })).rejects.toThrow()

    expect(await prisma.nasiyaPayment.count({ where: { shopId: shop.id } })).toBe(0)
  })

  it('rejects return and supplier-payable links whose device does not match their Sale', async () => {
    const { owner, shop } = await seedShop('relationship_checks')
    const first = await seedSale('relationship_1', shop.id, owner.id)
    const second = await seedSale('relationship_2', shop.id, owner.id)

    await expect(prisma.deviceReturn.create({
      data: {
        shopId: shop.id,
        deviceId: first.device.id,
        saleId: second.sale.id,
        idempotencyKey: 'cross-device-return-link',
        ledgerVersion: 2,
        refundAmount: 0,
        refundInputAmount: 0,
        refundInputCurrency: 'UZS',
        contractReceiptsAtReturn: 0,
        contractRefundAmount: 0,
        contractRetainedAmount: 0,
        note: 'Cross-device link accepted by database',
        createdBy: owner.id,
      },
    })).rejects.toMatchObject({ code: 'P2003' })
    await expect(prisma.supplierPayable.create({
      data: {
        shopId: shop.id,
        deviceId: first.device.id,
        saleId: second.sale.id,
        supplierName: 'Audit supplier',
        supplierPhone: '+998901111112',
        amount: 500,
        contractAmount: 500,
        dueDate: new Date('2026-08-01T00:00:00.000Z'),
        createdBy: owner.id,
      },
    })).rejects.toMatchObject({ code: 'P2003' })
  })

  it('rejects a DeviceReturn with neither a Sale nor Nasiya link', async () => {
    const { owner, shop } = await seedShop('return_shape')
    const device = await prisma.device.create({
      data: { shopId: shop.id, model: 'Unlinked return', purchasePrice: 100, imei: 'AUDIT-RETURN-SHAPE', addedBy: owner.id },
    })
    await expect(prisma.deviceReturn.create({
      data: {
        shopId: shop.id,
        deviceId: device.id,
        idempotencyKey: 'unlinked-return-shape',
        ledgerVersion: 2,
        refundAmount: 0,
        refundInputAmount: 0,
        refundInputCurrency: 'UZS',
        contractReceiptsAtReturn: 0,
        contractRefundAmount: 0,
        contractRetainedAmount: 0,
        note: 'No contract link',
        createdBy: owner.id,
      },
    })).rejects.toThrow('DeviceReturn_exactly_one_contract_check')
  })

  it('rejects refund allocations from a different contract in the same shop', async () => {
    const { owner, shop } = await seedShop('allocation_contract_link')
    const first = await seedSale('allocation_link_1', shop.id, owner.id)
    const second = await seedSale('allocation_link_2', shop.id, owner.id)
    await prisma.salePayment.create({
      data: {
        shopId: shop.id,
        saleId: first.sale.id,
        amount: 1_000,
        appliedAmountInContractCurrency: 1_000,
        paymentMethod: 'CASH',
        createdBy: owner.id,
      },
    })
    const foreignPayment = await prisma.salePayment.create({
      data: {
        shopId: shop.id,
        saleId: second.sale.id,
        amount: 1_000,
        appliedAmountInContractCurrency: 1_000,
        paymentMethod: 'CASH',
        createdBy: owner.id,
      },
    })

    await expect(prisma.$transaction(async (tx) => {
      const returned = await tx.deviceReturn.create({
        data: {
          shopId: shop.id,
          deviceId: first.device.id,
          saleId: first.sale.id,
          idempotencyKey: 'wrong-contract-allocation',
          ledgerVersion: 2,
          refundAmount: 100,
          refundInputAmount: 100,
          refundInputCurrency: 'UZS',
          refundMethod: 'CASH',
          contractAmount: 1_000,
          contractReceiptsAtReturn: 1_000,
          contractRefundAmount: 100,
          contractRetainedAmount: 900,
          note: 'Wrong receipt link must fail',
          createdBy: owner.id,
        },
      })
      await tx.returnRefundAllocation.create({
        data: {
          shopId: shop.id,
          deviceReturnId: returned.id,
          salePaymentId: foreignPayment.id,
          sourcePaymentMethod: 'CASH',
          refundMethod: 'CASH',
          contractCurrency: 'UZS',
          contractAmount: 100,
          amountUzs: 100,
        },
      })
    })).rejects.toThrow('sale refund allocation does not belong to returned sale')
    expect(await prisma.deviceReturn.count({ where: { saleId: first.sale.id } })).toBe(0)
  })

  it('enforces return totals and freezes original payments after commit', async () => {
    const { owner, shop } = await seedShop('return_reconciliation')
    const contract = await seedSale('return_reconciliation', shop.id, owner.id)
    const payment = await prisma.salePayment.create({
      data: {
        shopId: shop.id,
        saleId: contract.sale.id,
        amount: 1_000,
        appliedAmountInContractCurrency: 1_000,
        paymentMethod: 'CASH',
        createdBy: owner.id,
      },
    })
    const returned = await prisma.$transaction(async (tx) => {
      const returnRow = await tx.deviceReturn.create({
        data: {
          shopId: shop.id,
          deviceId: contract.device.id,
          saleId: contract.sale.id,
          idempotencyKey: 'reconciled-return',
          ledgerVersion: 2,
          refundAmount: 100,
          refundInputAmount: 100,
          refundInputCurrency: 'UZS',
          refundMethod: 'CASH',
          contractAmount: 1_000,
          contractReceiptsAtReturn: 1_000,
          contractRefundAmount: 100,
          contractRetainedAmount: 900,
          note: 'Reconciled return',
          createdBy: owner.id,
        },
      })
      await tx.returnRefundAllocation.create({
        data: {
          shopId: shop.id,
          deviceReturnId: returnRow.id,
          salePaymentId: payment.id,
          sourcePaymentMethod: 'CASH',
          refundMethod: 'CASH',
          contractCurrency: 'UZS',
          contractAmount: 100,
          amountUzs: 100,
        },
      })
      return returnRow
    })

    await expect(prisma.returnRefundAllocation.create({
      data: {
        shopId: shop.id,
        deviceReturnId: returned.id,
        salePaymentId: payment.id,
        sourcePaymentMethod: 'CASH',
        refundMethod: 'CASH',
        contractCurrency: 'UZS',
        contractAmount: 1,
        amountUzs: 1,
      },
    })).rejects.toThrow('refund allocations do not reconcile')
    await expect(prisma.salePayment.update({ where: { id: payment.id }, data: { amount: 999 } }))
      .rejects.toThrow('SalePayment is append-only financial evidence')
    await expect(prisma.salePayment.create({
      data: {
        shopId: shop.id,
        saleId: contract.sale.id,
        amount: 1,
        paymentMethod: 'CASH',
        createdBy: owner.id,
      },
    })).rejects.toThrow('payments for a returned contract are immutable')
    expect(await prisma.returnRefundAllocation.count({ where: { deviceReturnId: returned.id } })).toBe(1)
    expect(Number((await prisma.salePayment.findUniqueOrThrow({ where: { id: payment.id } })).amount)).toBe(1_000)
  })

  it('keeps the pre-ledger return writer compatible during migrate-before-publish', async () => {
    const { owner, shop } = await seedShop('legacy_window')
    const contract = await seedSale('legacy_window', shop.id, owner.id)
    await prisma.salePayment.create({
      data: {
        shopId: shop.id,
        saleId: contract.sale.id,
        amount: 1_000,
        paymentMethod: 'CASH',
        createdBy: owner.id,
      },
    })

    await prisma.$transaction(async (tx) => {
      await tx.device.update({ where: { id: contract.device.id }, data: { status: 'IN_STOCK' } })
      await tx.sale.update({
        where: { id: contract.sale.id },
        data: { deletedAt: new Date(), deletedBy: owner.id, deleteNote: 'RETURN: compatibility window' },
      })
      await tx.$executeRaw`
        INSERT INTO "DeviceReturn" (
          "id", "shopId", "deviceId", "saleId", "refundAmount", "note", "createdBy"
        ) VALUES (
          'legacy-window-return', ${shop.id}, ${contract.device.id}, ${contract.sale.id}, 0,
          'Compatibility window return', ${owner.id}
        )
      `
    })

    const returned = await prisma.deviceReturn.findUniqueOrThrow({ where: { id: 'legacy-window-return' } })
    expect(returned.ledgerVersion).toBe(1)
    expect(returned.idempotencyKey).toMatch(/^legacy-return:/)
    expect((await prisma.sale.findUniqueOrThrow({ where: { id: contract.sale.id } })).deletedAt).not.toBeNull()
  })
})

describe('adversarial lifecycle and history interleavings', () => {
  it('blocks a stale guarded edit after a Sale commits', async () => {
    const { owner, shop } = await seedShop('edit_race')
    const customer = await prisma.customer.create({
      data: { shopId: shop.id, name: 'Race customer', phone: '+998904444441', normalizedPhone: '998904444441' },
    })
    const device = await prisma.device.create({
      data: { shopId: shop.id, model: 'Race phone', purchasePrice: 500, imei: 'AUDIT-EDIT-RACE', addedBy: owner.id },
    })

    const stalePrecheck = await prisma.device.findFirst({ where: { id: device.id, status: 'IN_STOCK', deletedAt: null } })
    expect(stalePrecheck).not.toBeNull()

    await prisma.$transaction(async (tx) => {
      expect((await tx.device.updateMany({ where: { id: device.id, status: 'IN_STOCK' }, data: { status: 'SOLD_CASH' } })).count).toBe(1)
      await tx.sale.create({
        data: {
          shopId: shop.id,
          deviceId: device.id,
          customerId: customer.id,
          salePrice: 1_000,
          amountPaid: 1_000,
          remainingAmount: 0,
          contractSalePrice: 1_000,
          contractAmountPaid: 1_000,
          contractRemainingAmount: 0,
          paymentMethod: 'CASH',
          createdBy: owner.id,
        },
      })
    })

    const edited = await prisma.device.updateMany({
      where: {
        id: device.id,
        shopId: shop.id,
        deletedAt: null,
        status: 'IN_STOCK',
        sales: { none: { deletedAt: null } },
        nasiya: { none: { deletedAt: null } },
      },
      data: { purchasePrice: 900 },
    })
    expect(edited.count).toBe(0)
    expect(Number((await prisma.device.findUniqueOrThrow({ where: { id: device.id } })).purchasePrice)).toBe(500)
  })

  it('blocks a stale guarded delete after a Sale commits', async () => {
    const { owner, shop } = await seedShop('delete_race')
    const customer = await prisma.customer.create({
      data: { shopId: shop.id, name: 'Delete customer', phone: '+998904444442', normalizedPhone: '998904444442' },
    })
    const device = await prisma.device.create({
      data: { shopId: shop.id, model: 'Delete race phone', purchasePrice: 500, imei: 'AUDIT-DELETE-RACE', addedBy: owner.id },
    })

    const [staleDevice, staleSales] = await Promise.all([
      prisma.device.findFirst({ where: { id: device.id, status: 'IN_STOCK', deletedAt: null } }),
      prisma.sale.count({ where: { deviceId: device.id, deletedAt: null } }),
    ])
    expect(staleDevice).not.toBeNull()
    expect(staleSales).toBe(0)

    await prisma.$transaction(async (tx) => {
      expect((await tx.device.updateMany({ where: { id: device.id, status: 'IN_STOCK' }, data: { status: 'SOLD_CASH' } })).count).toBe(1)
      await tx.sale.create({
        data: {
          shopId: shop.id,
          deviceId: device.id,
          customerId: customer.id,
          salePrice: 1_000,
          amountPaid: 1_000,
          remainingAmount: 0,
          contractSalePrice: 1_000,
          contractAmountPaid: 1_000,
          contractRemainingAmount: 0,
          paymentMethod: 'CASH',
          createdBy: owner.id,
        },
      })
    })

    const hidden = await prisma.device.updateMany({
      where: {
        id: device.id,
        shopId: shop.id,
        deletedAt: null,
        status: 'IN_STOCK',
        sales: { none: { deletedAt: null } },
        nasiya: { none: { deletedAt: null } },
      },
      data: { status: 'DELETED', deletedAt: new Date() },
    })
    expect(hidden.count).toBe(0)
    expect((await prisma.device.findUniqueOrThrow({ where: { id: device.id } })).deletedAt).toBeNull()
    expect(await prisma.sale.count({ where: { deviceId: device.id, deletedAt: null } })).toBe(1)
  })

  it('prevents a paid Sale from being soft-deleted and rewriting prior-period accrual', async () => {
    const { owner, shop } = await seedShop('history_rewrite')
    const { sale } = await seedSale('history_sale', shop.id, owner.id)
    await prisma.sale.update({ where: { id: sale.id }, data: { createdAt: new Date('2026-06-15T00:00:00.000Z') } })
    await prisma.salePayment.create({
      data: {
        saleId: sale.id,
        shopId: shop.id,
        amount: 1_000,
        appliedAmountInContractCurrency: 1_000,
        paymentMethod: 'CASH',
        paidAt: new Date('2026-06-15T00:00:00.000Z'),
        createdBy: owner.id,
      },
    })

    const june = { gte: new Date('2026-06-01T00:00:00.000Z'), lt: new Date('2026-07-01T00:00:00.000Z') }
    expect(await prisma.sale.count({ where: { shopId: shop.id, deletedAt: null, createdAt: june } })).toBe(1)
    expect(Number((await prisma.salePayment.aggregate({ _sum: { amount: true }, where: { shopId: shop.id, deletedAt: null, paidAt: june } }))._sum.amount)).toBe(1_000)

    await expect(
      prisma.sale.update({ where: { id: sale.id }, data: { deletedAt: new Date('2026-07-10T00:00:00.000Z') } }),
    ).rejects.toThrow('sale with receipts cannot be soft-deleted')
    expect(await prisma.sale.count({ where: { shopId: shop.id, deletedAt: null, createdAt: june } })).toBe(1)
    expect(Number((await prisma.salePayment.aggregate({ _sum: { amount: true }, where: { shopId: shop.id, deletedAt: null, paidAt: june } }))._sum.amount)).toBe(1_000)
  })
})

describe('version-2 parent creation evidence immutability', () => {
  it('rejects coherent parent rewrites while preserving operational and legacy updates', async () => {
    const { owner, shop } = await seedShop('v2_parent_evidence')
    const hash = 'a'.repeat(64)
    const customer = await prisma.customer.create({
      data: {
        shopId: shop.id,
        name: 'Evidence customer',
        phone: '+998901112233',
        normalizedPhone: '998901112233',
      },
    })

    await expect(prisma.device.create({
      data: {
        shopId: shop.id,
        model: 'Unlinked evidence device',
        purchasePrice: 600,
        purchaseCurrency: 'UZS',
        purchaseInputAmount: 600,
        purchaseAmountUzsSnapshot: 600,
        imei: 'V2-EVIDENCE-UNLINKED',
        addedBy: owner.id,
        evidenceVersion: 2,
        evidenceStatus: 'CAPTURED',
      },
    })).rejects.toThrow('captured device requires exactly one acquisition evidence source')

    const legacyDevice = await prisma.device.create({
      data: {
        shopId: shop.id,
        model: 'Legacy evidence device',
        purchasePrice: 100,
        imei: 'V1-EVIDENCE-LEGACY',
        addedBy: owner.id,
        evidenceVersion: 1,
        evidenceStatus: 'LEGACY_UNKNOWN',
      },
    })
    const correctedLegacyDevice = await prisma.device.update({
      where: { id: legacyDevice.id },
      data: { purchasePrice: 125 },
    })
    expect(Number(correctedLegacyDevice.purchasePrice)).toBe(125)
    expect(correctedLegacyDevice.evidenceVersion).toBe(1)
    expect(correctedLegacyDevice.evidenceStatus).toBe('LEGACY_UNKNOWN')

    const { device: saleDevice } = await createCapturedUzsDeviceWithReceipt({
      shopId: shop.id,
      actorId: owner.id,
      model: 'Sale evidence device',
      imei: 'V2-EVIDENCE-SALE',
      amount: 600,
      status: 'SOLD_DEBT',
    })
    const sale = await prisma.sale.create({
      data: {
        shopId: shop.id,
        deviceId: saleDevice.id,
        customerId: customer.id,
        salePrice: 1_000,
        amountPaid: 0,
        remainingAmount: 1_000,
        paidFully: false,
        creationCurrency: 'UZS',
        contractCurrency: 'UZS',
        contractSalePrice: 1_000,
        contractAmountPaid: 0,
        contractRemainingAmount: 1_000,
        createdBy: owner.id,
        creationIdempotencyKey: 'sale:v2-parent-evidence',
        creationCommandHash: hash,
        evidenceVersion: 2,
        evidenceStatus: 'CAPTURED',
      },
    })

    await expect(
      prisma.device.update({
        where: { id: saleDevice.id },
        data: {
          purchasePrice: 700,
          purchaseInputAmount: 700,
          purchaseAmountUzsSnapshot: 700,
        },
      }),
    ).rejects.toThrow('version-2 device purchase evidence is immutable')

    await expect(
      prisma.sale.update({
        where: { id: sale.id },
        data: {
          salePrice: 1_100,
          remainingAmount: 1_100,
          contractSalePrice: 1_100,
          contractRemainingAmount: 1_100,
        },
      }),
    ).rejects.toThrow('version-2 sale creation evidence is immutable')

    const { device: nasiyaDevice } = await createCapturedUzsDeviceWithReceipt({
      shopId: shop.id,
      actorId: owner.id,
      model: 'Nasiya evidence device',
      imei: 'V2-EVIDENCE-NASIYA',
      amount: 500,
      status: 'SOLD_NASIYA',
    })
    const nasiya = await prisma.$transaction(async (tx) => {
      const created = await tx.nasiya.create({
        data: {
          shopId: shop.id,
          deviceId: nasiyaDevice.id,
          customerId: customer.id,
          totalAmount: 1_000,
          downPayment: 0,
          baseRemainingAmount: 1_000,
          interestPercent: 0,
          interestAmount: 0,
          finalNasiyaAmount: 1_000,
          remainingAmount: 1_000,
          months: 1,
          monthlyPayment: 1_000,
          startDate: new Date('2026-07-01T00:00:00.000Z'),
          creationCurrency: 'UZS',
          contractCurrency: 'UZS',
          contractTotalAmount: 1_000,
          contractDownPayment: 0,
          contractBaseRemainingAmount: 1_000,
          contractInterestAmount: 0,
          contractFinalAmount: 1_000,
          contractMonthlyPayment: 1_000,
          contractRemainingAmount: 1_000,
          contractPaidAmount: 0,
          createdBy: owner.id,
          creationIdempotencyKey: 'v2-nasiya-evidence-create',
          creationCommandHash: 'a'.repeat(64),
          evidenceVersion: 2,
          evidenceStatus: 'CAPTURED',
        },
      })
      await tx.nasiyaSchedule.create({
        data: {
          nasiyaId: created.id,
          shopId: shop.id,
          monthNumber: 1,
          dueDate: new Date('2026-08-01T00:00:00.000Z'),
          expectedAmount: 1_000,
          contractCurrency: 'UZS',
          contractExpectedAmount: 1_000,
          contractRemainingAmount: 1_000,
        },
      })
      return created
    })
    await expect(
      prisma.nasiya.update({
        where: { id: nasiya.id },
        data: { startDate: new Date('2026-07-02T00:00:00.000Z') },
      }),
    ).rejects.toThrow('version-2 nasiya creation evidence is immutable')

    const payable = await prisma.$transaction(async (tx) => {
      const device = await tx.device.create({
        data: {
          shopId: shop.id,
          model: 'Payable evidence device',
          purchasePrice: 600,
          purchaseCurrency: 'UZS',
          purchaseInputAmount: 600,
          purchaseAmountUzsSnapshot: 600,
          imei: 'V2-EVIDENCE-PAYABLE',
          addedBy: owner.id,
          evidenceVersion: 2,
          evidenceStatus: 'CAPTURED',
        },
      })
      const createdPayable = await tx.supplierPayable.create({
        data: {
          shopId: shop.id,
          deviceId: device.id,
          origin: 'DEVICE_PURCHASE',
          supplierName: 'Evidence supplier',
          supplierPhone: '+998909998877',
          amount: 600,
          contractCurrency: 'UZS',
          contractAmount: 600,
          paidAmount: 0,
          remainingAmount: 600,
          contractPaidAmount: 0,
          contractRemainingAmount: 600,
          dueDate: new Date('2026-08-01T00:00:00.000Z'),
          createdBy: owner.id,
          creationIdempotencyKey: 'payable:v2-parent-evidence',
          creationCommandHash: hash,
          evidenceVersion: 2,
          evidenceStatus: 'CAPTURED',
        },
      })
      return createdPayable
    })
    await expect(
      prisma.supplierPayable.update({
        where: { id: payable.id },
        data: {
          amount: 650,
          remainingAmount: 650,
          contractAmount: 650,
          contractRemainingAmount: 650,
        },
      }),
    ).rejects.toThrow('version-2 supplier payable creation evidence is immutable')

    await prisma.device.update({
      where: { id: saleDevice.id },
      data: { status: 'SOLD_CASH' },
    })
    await prisma.sale.update({
      where: { id: sale.id },
      data: {
        creationCurrency: 'UZS',
        dueDate: new Date('2026-08-15T00:00:00.000Z'),
        reminderEnabled: true,
        note: 'Operational update remains allowed',
      },
    })
    await prisma.nasiya.update({
      where: { id: nasiya.id },
      data: { status: 'OVERDUE', reminderEnabled: false },
    })
    await prisma.supplierPayable.update({
      where: { id: payable.id },
      data: { status: 'OVERDUE', reminderEnabled: false },
    })

    const currentSale = await prisma.sale.findUniqueOrThrow({
      where: { id: sale.id },
      select: { salePrice: true, reminderEnabled: true },
    })
    expect(Number(currentSale.salePrice)).toBe(1_000)
    expect(currentSale.reminderEnabled).toBe(true)
    expect(
      await prisma.nasiya.findUniqueOrThrow({
        where: { id: nasiya.id },
        select: { status: true },
      }),
    ).toMatchObject({ status: 'OVERDUE' })
    const currentPayable = await prisma.supplierPayable.findUniqueOrThrow({
      where: { id: payable.id },
      select: { amount: true, status: true },
    })
    expect(Number(currentPayable.amount)).toBe(600)
    expect(currentPayable.status).toBe('OVERDUE')
  })

  it('allows only legacy SalePayment component reconstruction and blocks every delete', async () => {
    const { owner, shop } = await seedShop('payment_component_evidence')
    const { sale } = await seedSale('payment_component_sale', shop.id, owner.id)

    const legacyPayment = await prisma.salePayment.create({
      data: {
        shopId: shop.id,
        saleId: sale.id,
        amount: 1_000,
        appliedAmountInContractCurrency: 1_000,
        paymentMethod: 'CASH',
        createdBy: owner.id,
        evidenceVersion: 1,
        evidenceStatus: 'LEGACY_UNKNOWN',
      },
    })
    const reconstructed = await prisma.salePayment.update({
      where: { id: legacyPayment.id },
      data: {
        contractPrincipalAmount: 600,
        contractMarginAmount: 400,
        principalAmountUzs: 600,
        marginAmountUzs: 400,
      },
    })
    expect(Number(reconstructed.contractPrincipalAmount)).toBe(600)
    expect(Number(reconstructed.contractMarginAmount)).toBe(400)
    await expect(
      prisma.salePayment.update({
        where: { id: legacyPayment.id },
        data: { amount: 999 },
      }),
    ).rejects.toThrow('SalePayment is append-only financial evidence')
    await expect(
      prisma.salePayment.delete({ where: { id: legacyPayment.id } }),
    ).rejects.toThrow('SalePayment is append-only financial evidence')

    const v2Payment = await prisma.salePayment.create({
      data: {
        shopId: shop.id,
        saleId: sale.id,
        amount: 1_000,
        paymentInputAmount: 1_000,
        paymentInputCurrency: 'UZS',
        appliedAmountInContractCurrency: 1_000,
        paymentMethod: 'CASH',
        createdBy: owner.id,
        idempotencyKey: 'sale-payment:v2-components',
        evidenceVersion: 2,
        evidenceStatus: 'CAPTURED',
        contractPrincipalAmount: 600,
        contractMarginAmount: 400,
        principalAmountUzs: 600,
        marginAmountUzs: 400,
      },
    })
    await expect(
      prisma.salePayment.update({
        where: { id: v2Payment.id },
        data: {
          contractPrincipalAmount: 500,
          contractMarginAmount: 500,
          principalAmountUzs: 500,
          marginAmountUzs: 500,
        },
      }),
    ).rejects.toThrow('version-2 sale payment components are immutable')
    await expect(
      prisma.salePayment.delete({ where: { id: v2Payment.id } }),
    ).rejects.toThrow('SalePayment is append-only financial evidence')
  })

  it('keeps governed rates, shop receipts, and device purchase receipts fully append-only', async () => {
    const { owner, shop } = await seedShop('fully_append_only_evidence')

    const rate = await prisma.currencyRate.create({
      data: {
        baseCurrency: 'USD',
        quoteCurrency: 'UZS',
        rate: 12_500,
        source: 'CBU',
        fetchedAt: new Date('2026-07-23T06:00:00.000Z'),
        effectiveDate: new Date('2026-07-23T00:00:00.000Z'),
        providerReference: 'append-only-rate-2026-07-23',
        evidenceVersion: 2,
        evidenceStatus: 'CAPTURED',
      },
    })
    await expect(
      prisma.currencyRate.update({
        where: { id: rate.id },
        data: { rate: 12_600 },
      }),
    ).rejects.toThrow('CurrencyRate is append-only financial evidence')
    await expect(
      prisma.currencyRate.delete({ where: { id: rate.id } }),
    ).rejects.toThrow('CurrencyRate is append-only financial evidence')

    const shopPayment = await prisma.shopPayment.create({
      data: {
        shopId: shop.id,
        amount: 1_000,
        months: 1,
        paymentMethod: 'CASH',
        currency: 'UZS',
        amountUzsSnapshot: 1_000,
        currencyReconstructionStatus: 'COMPLETE',
        recordedById: owner.id,
        evidenceVersion: 1,
        evidenceStatus: 'LEGACY_UNKNOWN',
      },
    })
    await expect(
      prisma.shopPayment.update({
        where: { id: shopPayment.id },
        data: { note: 'Forbidden receipt rewrite' },
      }),
    ).rejects.toThrow('ShopPayment is append-only financial evidence')
    await expect(
      prisma.shopPayment.delete({ where: { id: shopPayment.id } }),
    ).rejects.toThrow('ShopPayment is append-only financial evidence')

    const { receipt } = await createCapturedUzsDeviceWithReceipt({
      shopId: shop.id,
      actorId: owner.id,
      model: 'Paid-now evidence device',
      imei: 'V2-APPEND-ONLY-RECEIPT',
      amount: 700,
    })
    await expect(
      prisma.devicePurchaseReceipt.update({
        where: { id: receipt.id },
        data: { paymentMethod: 'CARD' },
      }),
    ).rejects.toThrow('DevicePurchaseReceipt is append-only financial evidence')
    await expect(
      prisma.devicePurchaseReceipt.delete({ where: { id: receipt.id } }),
    ).rejects.toThrow('DevicePurchaseReceipt is append-only financial evidence')
  })
})

describe('adversarial notification and identity persistence', () => {
  it('rejects the same live Telegram ID across super-admin and shop-admin roles', async () => {
    const { owner, shop } = await seedShop('telegram_owner')
    const telegramId = '123456789'
    await prisma.superAdmin.update({ where: { id: owner.id }, data: { telegramId } })
    await expect(prisma.shopAdmin.create({
      data: {
        shopId: shop.id,
        name: 'Duplicate Telegram owner',
        phone: '+998905555551',
        login: 'duplicate_telegram_owner',
        telegramId,
        passwordHash: 'audit-only',
      },
    })).rejects.toThrow()
    expect(await prisma.superAdmin.count({ where: { telegramId } })).toBe(1)
    expect(await prisma.shopAdmin.count({ where: { telegramId } })).toBe(0)
  })

  it('reclaims a PROCESSING notification whose claim timestamp was never persisted', async () => {
    const { shop } = await seedShop('notification_claim')
    const recipient = await prisma.shopAdmin.create({
      data: {
        shopId: shop.id,
        name: 'Notification claim recipient',
        phone: '+998905555552',
        login: 'notification_claim_recipient',
        telegramId: '123456789',
        passwordHash: 'audit-only',
      },
    })
    const future = new Date(Date.now() + 60 * 60 * 1000)
    const notification = await prisma.notification.create({
      data: {
        shopId: shop.id,
        type: 'AUDIT',
        message: 'No customer data',
        telegramId: '123456789',
        recipientShopAdminId: recipient.id,
        status: 'PROCESSING',
        scheduledAt: new Date(Date.now() - 60_000),
        lastAttemptAt: null,
        nextAttemptAt: future,
      },
    })

    const claim = await prisma.notification.updateMany({
      where: {
        id: notification.id,
        OR: [
          {
            status: { in: ['PENDING', 'FAILED'] },
            scheduledAt: { lte: new Date() },
            OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
          },
          {
            status: 'PROCESSING',
            OR: [
              { lastAttemptAt: null },
              { lastAttemptAt: { lte: new Date(Date.now() - 5 * 60 * 1000) } },
            ],
          },
        ],
      },
      data: { status: 'PROCESSING', attemptCount: { increment: 1 }, lastAttemptAt: new Date() },
    })

    expect(claim.count).toBe(1)
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: notification.id } })).status).toBe('PROCESSING')
  })
})
