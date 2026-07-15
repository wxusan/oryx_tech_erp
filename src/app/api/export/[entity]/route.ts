import { NextRequest } from 'next/server'
import writeXlsxFile, { type Cell, type SheetData } from 'write-excel-file/node'
import { requireShopPermission, resolveActiveShopId } from '@/lib/api-auth'
import type { ShopPermissionCode } from '@/lib/access-control'
import { csvRows } from '@/lib/csv'
import { formatMoneyByCurrency, formatUserFacingMoney } from '@/lib/currency'
import { displayImei } from '@/lib/device-display'
import { prisma } from '@/lib/prisma'
import { deviceStatusLabel, nasiyaStatusLabel, paymentMethodLabel } from '@/lib/labels'
import { deriveContractNasiyaStatus } from '@/lib/nasiya-contract-status'
import { getShopCurrencyContext } from '@/lib/server/currency'
import { deviceConditionLabel, formatDeviceStorage } from '@/lib/device-specs'
import { logger } from '@/lib/logger'
import { isMonthKey, resolveReportRange, type ReportRangePreset } from '@/lib/report-range'
import { getShopRangeReport, getShopReportDataMonths, type ShopRangeReport } from '@/lib/server/shop-report-range'
import { tashkentMonthRange } from '@/lib/timezone'

type RouteContext = { params: Promise<{ entity: string }> }
type ExportCell = string | number | boolean | Date | null | undefined
type ExportData = { headers: string[]; rows: ExportCell[][] }
type ExportFormat = 'csv' | 'xlsx'

export const runtime = 'nodejs'

const EXPORT_ROW_LIMIT = 5000
const EXPORT_BATCH_SIZE = 500

class ExportTooLargeError extends Error {
  constructor(
    readonly entity: string,
    readonly count: number,
  ) {
    super(`Export ${entity} has ${count} rows`)
  }
}

function fileHeaders(entity: string, format: ExportFormat, contentType: string) {
  return {
    'Content-Type': contentType,
    'Content-Disposition': `attachment; filename="${entity}.${format}"`,
  }
}

function csvResponse(entity: string, body: string) {
  return new Response(body, {
    headers: fileHeaders(entity, 'csv', 'text/csv; charset=utf-8'),
  })
}

function normalizeFormat(value: string | null): ExportFormat | null {
  if (!value || value === 'csv') return 'csv'
  if (value === 'xlsx') return 'xlsx'
  return null
}

function formatNativeContractAmount(amount: { toString(): string }, amountCurrency: 'UZS' | 'USD') {
  return formatUserFacingMoney({
    amount: amount.toString(),
    amountCurrency,
    displayCurrency: amountCurrency,
  })
}

function excelValue(value: ExportCell): Cell {
  return value ?? ''
}

async function assertExportSize(entity: string, count: Promise<number>) {
  const total = await count
  if (total > EXPORT_ROW_LIMIT) {
    throw new ExportTooLargeError(entity, total)
  }
  return total
}

async function fetchExportRows<T>(
  total: number,
  fetchBatch: (skip: number, take: number) => Promise<T[]>,
) {
  const rows: T[] = []

  for (let skip = 0; skip < total; skip += EXPORT_BATCH_SIZE) {
    const batch = await fetchBatch(skip, Math.min(EXPORT_BATCH_SIZE, total - skip))
    rows.push(...batch)
  }

  return rows
}

async function xlsxResponse(entity: string, data: ExportData) {
  const sheetData: SheetData = [
    data.headers.map((header) => ({ value: header, fontWeight: 'bold' })),
    ...data.rows.map((row) => row.map(excelValue)),
  ]
  const columns = data.headers.map((header, index) => {
    const values = data.rows.map((row) => row[index])
    return {
      width: Math.min(
        48,
        Math.max(
          12,
          header.length,
          ...values.map((value) => {
            if (value instanceof Date) return value.toISOString().length
            return value == null ? 0 : String(value).length
          }),
        ) + 2,
      ),
    }
  })

  const buffer = await writeXlsxFile(sheetData, {
    sheet: entity,
    columns,
    dateFormat: 'yyyy-mm-dd hh:mm:ss',
    stickyRowsCount: 1,
  }).toBuffer()

  return new Response(new Uint8Array(buffer), {
    headers: fileHeaders(
      entity,
      'xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ),
  })
}

function exportResponse(entity: string, format: ExportFormat, data: ExportData) {
  if (format === 'xlsx') return xlsxResponse(entity, data)
  return csvResponse(entity, csvRows(data.headers, data.rows))
}

function reportExportData(report: ShopRangeReport): ExportData {
  const row = (month: ShopRangeReport['months'][number], label: string): ExportCell[] => [
    label,
    month.cashCollected.uzs,
    month.cashCollected.usd,
    month.cashCollected.complete,
    month.cashCollected.uzs - month.refunds.uzs,
    month.cashCollected.usd - month.refunds.usd,
    month.grossProfitUzs,
    month.interestProfitUzs,
    month.expectedProfit.uzs,
    month.expectedProfit.usd,
    month.nasiyaInterestExpected.uzs,
    month.nasiyaInterestExpected.usd,
    month.expectedReceivables.uzs,
    month.expectedReceivables.usd,
    month.refunds.uzs,
    month.refunds.usd,
    month.writeOffs.uzs,
    month.writeOffs.usd,
    month.writeOffs.frozenUzs,
    month.returnCount,
    month.writeOffCount,
    month.reopenCount,
  ]
  return {
    headers: [
      'month',
      'cashCollectedUzs',
      'cashCollectedUsd',
      'cashCollectedComplete',
      'netCashAfterRefundsUzs',
      'netCashAfterRefundsUsd',
      'actualProfitUzs',
      'nasiyaInterestReceivedUzs',
      'expectedProfitUzs',
      'expectedProfitUsd',
      'nasiyaInterestExpectedUzs',
      'nasiyaInterestExpectedUsd',
      'expectedReceivablesUzs',
      'expectedReceivablesUsd',
      'refundsUzs',
      'refundsUsd',
      'legacyWriteOffAuditUzs',
      'legacyWriteOffAuditUsd',
      'legacyWriteOffAuditFrozenUzs',
      'returnCount',
      'writeOffCount',
      'reopenCount',
    ],
    rows: [
      ...report.months.map((month) => row(month, month.monthKey)),
      row({ ...report.totals, monthKey: 'TOTAL' }, 'TOTAL'),
    ],
  }
}

async function exportData(entity: string, shopId: string, role: string): Promise<ExportData | null> {
  const currency = await getShopCurrencyContext(shopId)
  if (entity === 'devices') {
    const where = { shopId, deletedAt: null }
    const total = await assertExportSize(entity, prisma.device.count({ where }))
    const devices = await fetchExportRows(total, (skip, take) =>
      prisma.device.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        select: {
          id: true,
          model: true,
          imei: true,
          imeis: { where: { deletedAt: null }, select: { slot: true, value: true } },
          color: true,
          storage: true,
          storageAmount: true,
          storageUnit: true,
          conditionCode: true,
          batteryHealth: true,
          purchasePrice: true,
          purchaseCurrency: true,
          purchaseInputAmount: true,
          purchaseExchangeRateAtCreation: true,
          purchaseAmountUzsSnapshot: true,
          status: true,
          createdAt: true,
        },
      }),
    )
    return {
      headers: [
        'model',
        'imei',
        'secondaryImei',
        'color',
        'storage',
        'storageAmount',
        'storageUnit',
        'condition',
        'batteryHealth',
        'purchaseAmountNative',
        'purchaseCurrency',
        'purchaseExchangeRateAtCreation',
        'purchaseAmountUzsSnapshot',
        'purchasePriceUzs',
        'purchasePriceCurrentShopDisplay',
        'status',
        'createdAt',
      ],
      rows: devices.map((d) => [
        d.model,
        displayImei(d.imeis.find((entry) => entry.slot === 'PRIMARY')?.value ?? d.imei),
        displayImei(d.imeis.find((entry) => entry.slot === 'SECONDARY')?.value),
        d.color,
        formatDeviceStorage(d),
        d.storageAmount?.toString() ?? null,
        d.storageUnit,
        deviceConditionLabel(d.conditionCode),
        d.batteryHealth,
        d.purchaseInputAmount.toString(),
        d.purchaseCurrency,
        d.purchaseExchangeRateAtCreation?.toString() ?? null,
        d.purchaseAmountUzsSnapshot.toString(),
        d.purchasePrice.toString(),
        formatMoneyByCurrency(Number(d.purchaseAmountUzsSnapshot), currency.currency, currency.usdUzsRate),
        deviceStatusLabel(d.status),
        d.createdAt,
      ]),
    }
  }

  if (entity === 'customers') {
    const where = { shopId, deletedAt: null }
    const total = await assertExportSize(entity, prisma.customer.count({ where }))
    const customers = await fetchExportRows(total, (skip, take) =>
      prisma.customer.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        select: {
          name: true,
          phone: true,
          note: true,
          createdAt: true,
        },
      }),
    )
    return {
      headers: ['name', 'phone', 'note', 'createdAt'],
      rows: customers.map((c) => [c.name, c.phone, c.note, c.createdAt]),
    }
  }

  if (entity === 'sales') {
    const where = { shopId, deletedAt: null }
    const total = await assertExportSize(entity, prisma.sale.count({ where }))
    const sales = await fetchExportRows(total, (skip, take) =>
      prisma.sale.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        select: {
          contractCurrency: true,
          contractExchangeRateAtCreation: true,
          contractSalePrice: true,
          contractAmountPaid: true,
          contractRemainingAmount: true,
          salePrice: true,
          amountPaid: true,
          remainingAmount: true,
          paymentMethod: true,
          paidFully: true,
          dueDate: true,
          returnedAt: true,
          createdAt: true,
          customer: { select: { name: true, phone: true } },
          device: { select: { model: true } },
        },
      }),
    )
    return {
      headers: [
        'customer',
        'phone',
        'device',
        'contractCurrency',
        'contractExchangeRateAtCreation',
        'contractSalePrice',
        'contractAmountPaid',
        'contractRemainingAmount',
        'contractSalePriceNativeDisplay',
        'contractAmountPaidNativeDisplay',
        'contractRemainingAmountNativeDisplay',
        'salePriceUzsSnapshot',
        'salePriceCurrentShopDisplay',
        'amountPaidUzsSnapshot',
        'amountPaidCurrentShopDisplay',
        'remainingAmountUzsSnapshot',
        'remainingAmountCurrentShopDisplay',
        'paymentMethod',
        'paidFully',
        'dueDate',
        'returnedAt',
        'createdAt',
      ],
      rows: sales.map((s) => [
        s.customer.name,
        s.customer.phone,
        s.device.model,
        s.contractCurrency,
        s.contractExchangeRateAtCreation?.toString() ?? '',
        s.contractSalePrice.toString(),
        s.contractAmountPaid.toString(),
        s.contractRemainingAmount.toString(),
        formatNativeContractAmount(s.contractSalePrice, s.contractCurrency),
        formatNativeContractAmount(s.contractAmountPaid, s.contractCurrency),
        formatNativeContractAmount(s.contractRemainingAmount, s.contractCurrency),
        s.salePrice.toString(),
        formatMoneyByCurrency(Number(s.salePrice), currency.currency, currency.usdUzsRate),
        s.amountPaid.toString(),
        formatMoneyByCurrency(Number(s.amountPaid), currency.currency, currency.usdUzsRate),
        s.remainingAmount.toString(),
        formatMoneyByCurrency(Number(s.remainingAmount), currency.currency, currency.usdUzsRate),
        paymentMethodLabel(s.paymentMethod),
        s.paidFully,
        s.dueDate,
        s.returnedAt,
        s.createdAt,
      ]),
    }
  }

  if (entity === 'nasiya') {
    const where = { shopId, deletedAt: null }
    const total = await assertExportSize(entity, prisma.nasiya.count({ where }))
    const nasiyalar = await fetchExportRows(total, (skip, take) =>
      prisma.nasiya.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        select: {
          id: true,
          totalAmount: true,
          downPayment: true,
          baseRemainingAmount: true,
          interestPercent: true,
          interestAmount: true,
          finalNasiyaAmount: true,
          remainingAmount: true,
          months: true,
          status: true,
          resolutionState: true,
          resolutionUpdatedAt: true,
          contractCurrency: true,
          contractExchangeRateAtCreation: true,
          contractTotalAmount: true,
          contractDownPayment: true,
          contractBaseRemainingAmount: true,
          contractInterestAmount: true,
          contractFinalAmount: true,
          contractMonthlyPayment: true,
          contractPaidAmount: true,
          contractRemainingAmount: true,
          returnedAt: true,
          createdAt: true,
          isImported: true,
          importSource: true,
          originalTotalAmount: true,
          alreadyPaidBeforeImport: true,
          remainingAtImport: true,
          importedAt: true,
          originalSaleDate: true,
          customer: { select: { name: true, phone: true } },
          device: { select: { model: true } },
          schedules: {
            select: {
              status: true,
              dueDate: true,
              delayedUntil: true,
              expectedAmount: true,
              paidAmount: true,
              contractExpectedAmount: true,
              contractPaidAmount: true,
            },
          },
        },
      }),
    )
    const resolutionEvents = await prisma.nasiyaResolutionEvent.findMany({
      where: { shopId, nasiyaId: { in: nasiyalar.map((n) => n.id) } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        nasiyaId: true,
        eventType: true,
        nativeRemainingAmount: true,
        contractCurrency: true,
        frozenUzsAmount: true,
        frozenUsdUzsRate: true,
        reason: true,
        reversesEventId: true,
        createdAt: true,
      },
    })
    const latestResolutionByNasiya = new Map<string, (typeof resolutionEvents)[number]>()
    for (const event of resolutionEvents) {
      if (!latestResolutionByNasiya.has(event.nasiyaId)) latestResolutionByNasiya.set(event.nasiyaId, event)
    }
    // Export the live contract-derived status so the sheet agrees with the
    // list/detail even when legacy UZS mirrors drift after an FX movement.
    const exportNow = new Date()
    return {
      headers: [
        'customer',
        'phone',
        'device',
        'contractCurrency',
        'contractExchangeRateAtCreation',
        'contractTotalAmount',
        'contractDownPayment',
        'contractBaseRemainingAmount',
        'contractInterestAmount',
        'contractFinalAmount',
        'contractMonthlyPayment',
        'contractPaidAmount',
        'contractRemainingAmount',
        'contractFinalAmountNativeDisplay',
        'contractRemainingAmountNativeDisplay',
        'totalAmountUzsSnapshot',
        'totalAmountCurrentShopDisplay',
        'downPaymentUzsSnapshot',
        'downPaymentCurrentShopDisplay',
        'baseRemainingAmountUzsSnapshot',
        'baseRemainingAmountCurrentShopDisplay',
        'interestPercent',
        'interestAmountUzsSnapshot',
        'interestAmountCurrentShopDisplay',
        'finalNasiyaAmountUzsSnapshot',
        'finalNasiyaAmountCurrentShopDisplay',
        'remainingAmountUzsSnapshot',
        'remainingAmountCurrentShopDisplay',
        'months',
        'status',
        'resolutionState',
        'resolutionUpdatedAt',
        'latestResolutionEvent',
        'latestResolutionReason',
        'latestResolutionNativeAmount',
        'latestResolutionCurrency',
        'latestResolutionFrozenUzs',
        'latestResolutionFrozenUsdUzsRate',
        'latestResolutionReversesEventId',
        'latestResolutionCreatedAt',
        'returnedAt',
        'createdAt',
        'isImported',
        'importSource',
        'originalTotalAmount',
        'alreadyPaidBeforeImport',
        'remainingAtImport',
        'importedAt',
        'originalSaleDate',
      ],
      rows: nasiyalar.map((n) => {
        const resolution = latestResolutionByNasiya.get(n.id)
        return [
        n.customer.name,
        n.customer.phone,
        n.device.model,
        n.contractCurrency,
        n.contractExchangeRateAtCreation?.toString() ?? '',
        n.contractTotalAmount.toString(),
        n.contractDownPayment.toString(),
        n.contractBaseRemainingAmount.toString(),
        n.contractInterestAmount.toString(),
        n.contractFinalAmount.toString(),
        n.contractMonthlyPayment.toString(),
        n.contractPaidAmount.toString(),
        n.contractRemainingAmount.toString(),
        formatNativeContractAmount(n.contractFinalAmount, n.contractCurrency),
        formatNativeContractAmount(n.contractRemainingAmount, n.contractCurrency),
        n.totalAmount.toString(),
        formatMoneyByCurrency(Number(n.totalAmount), currency.currency, currency.usdUzsRate),
        n.downPayment.toString(),
        formatMoneyByCurrency(Number(n.downPayment), currency.currency, currency.usdUzsRate),
        n.baseRemainingAmount.toString(),
        formatMoneyByCurrency(Number(n.baseRemainingAmount), currency.currency, currency.usdUzsRate),
        n.interestPercent.toString(),
        n.interestAmount.toString(),
        formatMoneyByCurrency(Number(n.interestAmount), currency.currency, currency.usdUzsRate),
        n.finalNasiyaAmount.toString(),
        formatMoneyByCurrency(Number(n.finalNasiyaAmount), currency.currency, currency.usdUzsRate),
        n.remainingAmount.toString(),
        formatMoneyByCurrency(Number(n.remainingAmount), currency.currency, currency.usdUzsRate),
        n.months,
        nasiyaStatusLabel(
          deriveContractNasiyaStatus(
            {
              status: n.status,
              contractCurrency: n.contractCurrency,
              contractFinalAmount: Number(n.contractFinalAmount),
              contractRemainingAmount: Number(n.contractRemainingAmount),
              schedules: n.schedules.map((s) => ({
                status: s.status,
                dueDate: s.dueDate,
                delayedUntil: s.delayedUntil,
                expectedAmount: Number(s.expectedAmount),
                paidAmount: Number(s.paidAmount),
                contractExpectedAmount: Number(s.contractExpectedAmount),
                contractPaidAmount: Number(s.contractPaidAmount),
              })),
            },
            exportNow,
          ).displayStatus,
        ),
        n.resolutionState,
        n.resolutionUpdatedAt,
        resolution?.eventType ?? '',
        resolution?.reason ?? '',
        resolution?.nativeRemainingAmount.toString() ?? '',
        resolution?.contractCurrency ?? '',
        resolution?.frozenUzsAmount.toString() ?? '',
        resolution?.frozenUsdUzsRate.toString() ?? '',
        resolution?.reversesEventId ?? '',
        resolution?.createdAt ?? '',
        n.returnedAt,
        n.createdAt,
        n.isImported,
        n.importSource ?? '',
        n.originalTotalAmount?.toString() ?? '',
        n.alreadyPaidBeforeImport.toString(),
        n.remainingAtImport?.toString() ?? '',
        n.importedAt,
        n.originalSaleDate,
        ]
      }),
    }
  }

  if (entity === 'olib') {
    const where = { shopId, deletedAt: null }
    const total = await assertExportSize(entity, prisma.supplierPayable.count({ where }))
    const payables = await fetchExportRows(total, (skip, take) =>
      prisma.supplierPayable.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        select: {
          supplierName: true,
          supplierPhone: true,
          supplierLocation: true,
          supplierNote: true,
          contractCurrency: true,
          contractExchangeRateAtCreation: true,
          contractAmount: true,
          amount: true,
          status: true,
          dueDate: true,
          paidAt: true,
          paymentMethod: true,
          note: true,
          createdAt: true,
          device: { select: { model: true, imei: true } },
          sale: {
            select: {
              contractCurrency: true,
              contractSalePrice: true,
              customer: { select: { name: true, phone: true } },
            },
          },
        },
      }),
    )
    return {
      headers: [
        'supplierName',
        'supplierPhone',
        'supplierLocation',
        'supplierNote',
        'device',
        'imei',
        'customer',
        'customerPhone',
        'payableCurrency',
        'payableExchangeRateAtCreation',
        'payableAmount',
        'payableAmountUzsSnapshot',
        'saleCurrency',
        'salePrice',
        'status',
        'dueDate',
        'paidAt',
        'paymentMethod',
        'note',
        'createdAt',
      ],
      rows: payables.map((item) => [
        item.supplierName,
        item.supplierPhone,
        item.supplierLocation,
        item.supplierNote,
        item.device.model,
        displayImei(item.device.imei),
        item.sale.customer.name,
        item.sale.customer.phone,
        item.contractCurrency,
        item.contractExchangeRateAtCreation?.toString() ?? '',
        item.contractAmount.toString(),
        item.amount.toString(),
        item.sale.contractCurrency,
        item.sale.contractSalePrice.toString(),
        item.status,
        item.dueDate,
        item.paidAt,
        paymentMethodLabel(item.paymentMethod),
        item.note,
        item.createdAt,
      ]),
    }
  }

  if (entity === 'returns') {
    const where = { shopId }
    const total = await assertExportSize(entity, prisma.deviceReturn.count({ where }))
    const returns = await fetchExportRows(total, (skip, take) =>
      prisma.deviceReturn.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        select: {
          refundAmount: true,
          refundInputAmount: true,
          refundInputCurrency: true,
          refundExchangeRateAtCreation: true,
          refundMethod: true,
          contractCurrency: true,
          contractAmount: true,
          contractReceiptsAtReturn: true,
          contractRefundAmount: true,
          contractRetainedAmount: true,
          contractCancelledDebt: true,
          revenueReversalAmountUzs: true,
          interestReversalAmountUzs: true,
          inventoryCostRecoveryUzs: true,
          retainedValueAmountUzs: true,
          refundAllocations: {
            select: {
              sourcePaymentMethod: true,
              refundMethod: true,
              contractAmount: true,
              amountUzs: true,
              salePaymentId: true,
              nasiyaPaymentId: true,
            },
          },
          note: true,
          createdAt: true,
          device: { select: { model: true, imei: true } },
          sale: { select: { customer: { select: { name: true } } } },
          nasiya: { select: { customer: { select: { name: true } } } },
        },
      }),
    )
    return {
      headers: [
        'device',
        'imei',
        'customer',
        'refundAmountUzs',
        'refundInputAmount',
        'refundInputCurrency',
        'refundExchangeRateAtCreation',
        'refundNativeDisplay',
        'refundMethod',
        'contractCurrency',
        'contractAmount',
        'contractReceiptsAtReturn',
        'contractRefundAmount',
        'contractRetainedAmount',
        'contractCancelledDebt',
        'revenueReversalAmountUzs',
        'interestReversalAmountUzs',
        'inventoryCostRecoveryUzs',
        'retainedValueAmountUzs',
        'refundAllocations',
        'note',
        'createdAt',
      ],
      rows: returns.map((item) => [
        item.device.model,
        displayImei(item.device.imei),
        item.sale?.customer.name ?? item.nasiya?.customer.name ?? '',
        item.refundAmount.toString(),
        (item.refundInputAmount ?? item.refundAmount).toString(),
        item.refundInputCurrency ?? 'UZS',
        item.refundExchangeRateAtCreation?.toString() ?? '',
        formatUserFacingMoney({
          amount: (item.refundInputAmount ?? item.refundAmount).toString(),
          amountCurrency: item.refundInputCurrency ?? 'UZS',
          displayCurrency: item.refundInputCurrency ?? 'UZS',
        }),
        paymentMethodLabel(item.refundMethod),
        item.contractCurrency,
        item.contractAmount.toString(),
        item.contractReceiptsAtReturn.toString(),
        item.contractRefundAmount.toString(),
        item.contractRetainedAmount.toString(),
        item.contractCancelledDebt.toString(),
        item.revenueReversalAmountUzs.toString(),
        item.interestReversalAmountUzs.toString(),
        item.inventoryCostRecoveryUzs.toString(),
        item.retainedValueAmountUzs.toString(),
        JSON.stringify(item.refundAllocations),
        item.note,
        item.createdAt,
      ]),
    }
  }

  if (entity === 'logs') {
    const where = {
      shopId,
      ...(role === 'SHOP_ADMIN' ? { actorType: 'SHOP_ADMIN' as const } : {}),
    }
    const total = await assertExportSize(entity, prisma.log.count({ where }))
    const logs = await fetchExportRows(total, (skip, take) =>
      prisma.log.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        select: {
          actorId: true,
          actorType: true,
          action: true,
          targetType: true,
          targetId: true,
          note: true,
          createdAt: true,
        },
      }),
    )
    return {
      headers: ['actorId', 'actorType', 'action', 'targetType', 'targetId', 'note', 'createdAt'],
      rows: logs.map((log) => [
        log.actorId,
        log.actorType,
        log.action,
        log.targetType,
        log.targetId,
        log.note,
        log.createdAt,
      ]),
    }
  }

  return null
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  try {
    const { entity } = await ctx.params
    const entityPermission: Record<string, ShopPermissionCode> = {
      devices: 'EXPORT_DEVICES',
      customers: 'EXPORT_CUSTOMERS',
      sales: 'EXPORT_SALES',
      nasiya: 'EXPORT_NASIYA',
      olib: 'EXPORT_OLIB',
      returns: 'EXPORT_RETURNS',
      logs: 'EXPORT_LOGS',
      report: 'EXPORT_REPORTS',
    }
    const permission = entityPermission[entity]
    if (!permission) return new Response('Unknown export entity', { status: 404 })
    const guarded = await requireShopPermission(permission)
    if (!guarded.ok) return guarded.response
    const { session } = guarded

    const format = normalizeFormat(req.nextUrl.searchParams.get('format'))
    if (!format) return new Response('Unsupported export format', { status: 400 })

    const resolved = await resolveActiveShopId(session, req.nextUrl.searchParams.get('shopId'))
    if (!resolved.ok) return resolved.response
    const { shopId } = resolved

    if (entity === 'report') {
      const params = req.nextUrl.searchParams
      const presetValue = params.get('preset')?.trim() || 'single'
      const presets = new Set<ReportRangePreset>(['single', 'trailing3', 'trailing6', 'trailing12', 'custom'])
      if (!presets.has(presetValue as ReportRangePreset)) return new Response("Hisobot turi noto'g'ri", { status: 400 })
      const month = params.get('month')?.trim() || null
      const startMonth = params.get('startMonth')?.trim() || null
      const endMonth = params.get('endMonth')?.trim() || null
      if ((month && !isMonthKey(month)) || (startMonth && !isMonthKey(startMonth)) || (endMonth && !isMonthKey(endMonth))) {
        return new Response("Hisobot oy oralig'i noto'g'ri", { status: 400 })
      }
      const adminId = params.get('admin')?.trim() || null
      if (adminId && !await prisma.shopAdmin.count({ where: { id: adminId, shopId, deletedAt: null } })) {
        return new Response("Tanlangan admin bu do'konga tegishli emas", { status: 400 })
      }
      const availableMonths = await getShopReportDataMonths(shopId)
      if (presetValue === 'single' && month && !availableMonths.includes(month)) {
        return new Response("Tanlangan oyda hisobot ma'lumoti yo'q", { status: 400 })
      }
      if (!availableMonths.length && presetValue === 'single' && !month) {
        return new Response("Eksport uchun hisobot ma'lumoti yo'q", { status: 404 })
      }
      let range
      try {
        range = resolveReportRange({
          preset: presetValue,
          month,
          startMonth,
          endMonth,
          defaultEndMonth: availableMonths[0] ?? tashkentMonthRange().monthKey,
        })
      } catch (error) {
        return new Response(error instanceof Error ? error.message : "Hisobot oralig'i noto'g'ri", { status: 400 })
      }
      if (!range.monthKeys.every((monthKey) => availableMonths.includes(monthKey))) {
        return new Response("Tanlangan oraliq do'konning ERP ishlatilgan oylaridan tashqarida", { status: 400 })
      }
      const report = await getShopRangeReport({ shopId, range, adminId })
      return exportResponse(`report-${range.startMonth}-${range.endMonth}`, format, reportExportData(report))
    }

    const data = await exportData(entity, shopId, session.user.role)
    if (!data) return new Response('Unknown export entity', { status: 404 })

    return exportResponse(entity, format, data)
  } catch (err) {
    if (err instanceof ExportTooLargeError) {
      return Response.json(
        {
          success: false,
          error: `Eksport hajmi juda katta: ${err.count} ta qator. Iltimos, ma'lumotni ${EXPORT_ROW_LIMIT} qatordan kamroq qiling.`,
        },
        { status: 413 },
      )
    }

    logger.error('[GET /api/export/[entity]]', { event: 'api.route_error', error: err })
    return Response.json({ success: false, error: 'Eksportda xatolik yuz berdi' }, { status: 500 })
  }
}
