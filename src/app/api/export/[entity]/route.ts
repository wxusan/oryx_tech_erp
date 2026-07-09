import { NextRequest } from 'next/server'
import writeXlsxFile, { type Cell, type SheetData } from 'write-excel-file/node'
import { requireApiSession, resolveActiveShopId } from '@/lib/api-auth'
import { csvRows } from '@/lib/csv'
import { formatMoneyByCurrency } from '@/lib/currency'
import { displayImei } from '@/lib/device-display'
import { prisma } from '@/lib/prisma'
import { deviceStatusLabel, nasiyaStatusLabel, paymentMethodLabel } from '@/lib/labels'
import { deriveContractNasiyaStatus } from '@/lib/nasiya-contract-status'
import { getShopCurrencyContext } from '@/lib/server/currency'
import { logger } from '@/lib/logger'

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
          model: true,
          imei: true,
          color: true,
          storage: true,
          batteryHealth: true,
          purchasePrice: true,
          status: true,
          createdAt: true,
        },
      }),
    )
    return {
      headers: [
        'model',
        'imei',
        'color',
        'storage',
        'batteryHealth',
        'purchasePriceUzs',
        'purchasePriceDisplay',
        'status',
        'createdAt',
      ],
      rows: devices.map((d) => [
        d.model,
        displayImei(d.imei),
        d.color,
        d.storage,
        d.batteryHealth,
        d.purchasePrice.toString(),
        formatMoneyByCurrency(Number(d.purchasePrice), currency.currency, currency.usdUzsRate),
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
          salePrice: true,
          amountPaid: true,
          remainingAmount: true,
          paymentMethod: true,
          paidFully: true,
          dueDate: true,
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
        'salePriceUzs',
        'salePriceDisplay',
        'amountPaidUzs',
        'amountPaidDisplay',
        'remainingAmountUzs',
        'remainingAmountDisplay',
        'paymentMethod',
        'paidFully',
        'dueDate',
        'createdAt',
      ],
      rows: sales.map((s) => [
        s.customer.name,
        s.customer.phone,
        s.device.model,
        s.salePrice.toString(),
        formatMoneyByCurrency(Number(s.salePrice), currency.currency, currency.usdUzsRate),
        s.amountPaid.toString(),
        formatMoneyByCurrency(Number(s.amountPaid), currency.currency, currency.usdUzsRate),
        s.remainingAmount.toString(),
        formatMoneyByCurrency(Number(s.remainingAmount), currency.currency, currency.usdUzsRate),
        paymentMethodLabel(s.paymentMethod),
        s.paidFully,
        s.dueDate,
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
          totalAmount: true,
          downPayment: true,
          baseRemainingAmount: true,
          interestPercent: true,
          interestAmount: true,
          finalNasiyaAmount: true,
          remainingAmount: true,
          months: true,
          status: true,
          contractCurrency: true,
          contractFinalAmount: true,
          contractRemainingAmount: true,
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
    // Export the live contract-derived status so the sheet agrees with the
    // list/detail even when legacy UZS mirrors drift after an FX movement.
    const exportNow = new Date()
    return {
      headers: [
        'customer',
        'phone',
        'device',
        'totalAmountUzs',
        'totalAmountDisplay',
        'downPaymentUzs',
        'downPaymentDisplay',
        'baseRemainingAmountUzs',
        'baseRemainingAmountDisplay',
        'interestPercent',
        'interestAmountUzs',
        'interestAmountDisplay',
        'finalNasiyaAmountUzs',
        'finalNasiyaAmountDisplay',
        'remainingAmountUzs',
        'remainingAmountDisplay',
        'months',
        'status',
        'createdAt',
        'isImported',
        'importSource',
        'originalTotalAmount',
        'alreadyPaidBeforeImport',
        'remainingAtImport',
        'importedAt',
        'originalSaleDate',
      ],
      rows: nasiyalar.map((n) => [
        n.customer.name,
        n.customer.phone,
        n.device.model,
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
        n.createdAt,
        n.isImported,
        n.importSource ?? '',
        n.originalTotalAmount?.toString() ?? '',
        n.alreadyPaidBeforeImport.toString(),
        n.remainingAtImport?.toString() ?? '',
        n.importedAt,
        n.originalSaleDate,
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
          refundMethod: true,
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
        'refundAmountDisplay',
        'refundMethod',
        'note',
        'createdAt',
      ],
      rows: returns.map((item) => [
        item.device.model,
        displayImei(item.device.imei),
        item.sale?.customer.name ?? item.nasiya?.customer.name ?? '',
        item.refundAmount.toString(),
        formatMoneyByCurrency(Number(item.refundAmount), currency.currency, currency.usdUzsRate),
        paymentMethodLabel(item.refundMethod),
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
    const guarded = await requireApiSession()
    if (!guarded.ok) return guarded.response
    const { session } = guarded
    const { entity } = await ctx.params

    const format = normalizeFormat(req.nextUrl.searchParams.get('format'))
    if (!format) return new Response('Unsupported export format', { status: 400 })

    const resolved = await resolveActiveShopId(session, req.nextUrl.searchParams.get('shopId'))
    if (!resolved.ok) return resolved.response
    const { shopId } = resolved

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
