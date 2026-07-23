import 'server-only'

import type { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { displayImei } from '@/lib/device-display'
import { computeSaleContractMargin } from '@/lib/nasiya-contract'
import { prepareSearchNeedle } from '@/lib/search-needle'
import { searchMatchEvidence } from '@/lib/search-match-evidence'
import type { SalesListPage } from '@/lib/sales-list-contract'
import { timeRequestPhase, timeRequestPhaseSync } from '@/lib/server/request-context'

export interface SalesListInput {
  shopId: string
  search?: string | null
  skip?: number
  take?: number
  includeOwnerFinancials: boolean
}

export function buildSalesWhere(shopId: string, searchValue?: string | null): Prisma.SaleWhereInput {
  const prepared = prepareSearchNeedle(searchValue)
  const search = prepared.query
  return {
    shopId,
    deletedAt: null,
    returnedAt: null,
    device: { deletedAt: null },
    ...(search
      ? {
          OR: [
            { device: { model: { contains: prepared.escapedText, mode: 'insensitive' } } },
            { device: { imei: { contains: prepared.escapedText, mode: 'insensitive' } } },
            {
              device: {
                imeis: {
                  some: {
                    deletedAt: null,
                    OR: [
                      { value: { contains: prepared.escapedText, mode: 'insensitive' } },
                      ...(prepared.identifierDigits
                        ? [{ normalizedValue: { contains: prepared.identifierDigits } }]
                        : []),
                    ],
                  },
                },
              },
            },
            { customer: { name: { contains: prepared.escapedText, mode: 'insensitive' } } },
            { customer: { phone: { contains: prepared.escapedText, mode: 'insensitive' } } },
            ...(prepared.identifierDigits
              ? [
                  { device: { imei: { contains: prepared.identifierDigits } } },
                  { customer: { phoneSearchDigits: { contains: prepared.identifierDigits } } },
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
    where: buildSalesWhere(input.shopId, input.search),
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
      customer: { select: { id: true, name: true, phone: true, additionalPhones: true } },
      device: {
        select: {
          id: true,
          model: true,
          color: true,
          storage: true,
          imei: true,
          imeis: {
            where: { deletedAt: null },
            orderBy: { slot: 'asc' },
            select: { slot: true, value: true },
          },
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
      customer: {
        id: sale.customer.id,
        name: sale.customer.name,
        phone: sale.customer.phone,
      },
      device: {
        id: sale.device.id,
        model: sale.device.model,
        color: sale.device.color,
        storage: sale.device.storage,
        imei: displayImei(sale.device.imei),
        secondaryImei: sale.device.imeis.find((entry) => entry.slot === 'SECONDARY')?.value ?? null,
      },
      ...(input.search
        ? {
            matchEvidence: searchMatchEvidence(input.search, [
              {
                field: 'SECONDARY_IMEI',
                value: sale.device.imeis.find((entry) => entry.slot === 'SECONDARY')?.value,
                mode: 'identifier',
              },
              ...sale.customer.additionalPhones.map((value) => ({
                field: 'ADDITIONAL_PHONE' as const,
                value,
                mode: 'identifier' as const,
                exposeValue: false,
              })),
            ]),
          }
        : {}),
    }
    })

    return { items, skip, take, hasNext }
  })
}
