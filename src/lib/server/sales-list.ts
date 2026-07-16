import 'server-only'

import type { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { displayImei } from '@/lib/device-display'
import { normalizePhone } from '@/lib/phone'
import { computeSaleContractMargin } from '@/lib/nasiya-contract'
import type { SalesListPage } from '@/lib/sales-list-contract'
import { timeRequestPhase, timeRequestPhaseSync } from '@/lib/server/request-context'

export interface SalesListInput {
  shopId: string
  search?: string | null
  skip?: number
  take?: number
  includeOwnerFinancials: boolean
}

function salesWhere(shopId: string, searchValue?: string | null): Prisma.SaleWhereInput {
  const search = searchValue?.trim()
  const digits = search ? normalizePhone(search) : null
  const normalizedImei = search?.replace(/[\s-]/g, '') || null
  return {
    shopId,
    deletedAt: null,
    returnedAt: null,
    device: { deletedAt: null },
    ...(search
      ? {
          OR: [
            { device: { model: { contains: search, mode: 'insensitive' } } },
            { device: { imei: { contains: search, mode: 'insensitive' } } },
            ...(normalizedImei
              ? [{ device: { imeis: { some: { deletedAt: null, normalizedValue: { contains: normalizedImei } } } } }]
              : []),
            { customer: { name: { contains: search, mode: 'insensitive' } } },
            { customer: { phone: { contains: search, mode: 'insensitive' } } },
            ...(digits
              ? [
                  { customer: { normalizedPhone: { contains: digits } } },
                  { customer: { additionalPhones: { has: digits } } },
                ]
              : []),
          ],
        }
      : {}),
  }
}

/** Dedicated bounded Sale query; no Device count or client-side sale filtering. */
export async function getSalesList(input: SalesListInput): Promise<SalesListPage> {
  const take = Math.trunc(Math.min(Math.max(input.take ?? 25, 1), 100))
  const skip = Math.trunc(Math.max(input.skip ?? 0, 0))
  const rows = await timeRequestPhase('database', () => prisma.sale.findMany({
    where: salesWhere(input.shopId, input.search),
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    skip,
    take: take + 1,
    select: {
      id: true,
      dueDate: true,
      reminderEnabled: true,
      contractCurrency: true,
      contractSalePrice: true,
      contractRemainingAmount: true,
      contractExchangeRateAtCreation: true,
      createdAt: true,
      customer: { select: { id: true, name: true, phone: true } },
      device: {
        select: {
          id: true,
          model: true,
          color: true,
          storage: true,
          imei: true,
          purchaseCurrency: true,
          purchaseInputAmount: true,
          purchaseAmountUzsSnapshot: true,
        },
      },
    },
  }))
  return timeRequestPhaseSync('dto', () => {
    const hasNext = rows.length > take
    const items = rows.slice(0, take).map((sale) => {
    const contractProfit = input.includeOwnerFinancials
      ? computeSaleContractMargin(
          Number(sale.contractSalePrice),
          sale.contractCurrency,
          sale.contractExchangeRateAtCreation == null ? null : Number(sale.contractExchangeRateAtCreation),
          {
            purchaseCurrency: sale.device.purchaseCurrency,
            purchaseInputAmount: Number(sale.device.purchaseInputAmount),
            purchaseAmountUzsSnapshot: Number(sale.device.purchaseAmountUzsSnapshot),
          },
        )
      : undefined

    return {
      id: sale.id,
      dueDate: sale.dueDate?.toISOString() ?? null,
      reminderEnabled: sale.reminderEnabled,
      contractCurrency: sale.contractCurrency,
      contractSalePrice: Number(sale.contractSalePrice),
      contractRemainingAmount: Number(sale.contractRemainingAmount),
      ...(input.includeOwnerFinancials ? { contractProfit } : {}),
      createdAt: sale.createdAt.toISOString(),
      customer: sale.customer,
      device: {
        id: sale.device.id,
        model: sale.device.model,
        color: sale.device.color,
        storage: sale.device.storage,
        imei: displayImei(sale.device.imei),
      },
    }
    })

    return { items, skip, take, hasNext }
  })
}
