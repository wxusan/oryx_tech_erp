import { NextRequest } from 'next/server'
import writeXlsxFile, { type Cell, type SheetData } from 'write-excel-file/node'
import { requireApiSession, resolveActiveShopId } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'
import { deviceStatusLabel, nasiyaStatusLabel, paymentMethodLabel } from '@/lib/labels'

type RouteContext = { params: Promise<{ entity: string }> }
type ExportCell = string | number | boolean | Date | null | undefined
type ExportData = { headers: string[]; rows: ExportCell[][] }
type ExportFormat = 'csv' | 'xlsx'

export const runtime = 'nodejs'

function csvValue(value: unknown) {
  const raw = value instanceof Date ? value.toISOString() : value == null ? '' : String(value)
  return `"${raw.replaceAll('"', '""')}"`
}

function csv(headers: string[], rows: unknown[][]) {
  return [headers, ...rows].map((row) => row.map(csvValue).join(',')).join('\n')
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
  return csvResponse(entity, csv(data.headers, data.rows))
}

async function exportData(entity: string, shopId: string, role: string): Promise<ExportData | null> {
  if (entity === 'devices') {
    const devices = await prisma.device.findMany({
      where: { shopId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    })
    return {
      headers: [
        'model',
        'imei',
        'color',
        'storage',
        'batteryHealth',
        'purchasePrice',
        'status',
        'createdAt',
      ],
      rows: devices.map((d) => [
        d.model,
        d.imei,
        d.color,
        d.storage,
        d.batteryHealth,
        d.purchasePrice.toString(),
        deviceStatusLabel(d.status),
        d.createdAt,
      ]),
    }
  }

  if (entity === 'customers') {
    const customers = await prisma.customer.findMany({
      where: { shopId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    })
    return {
      headers: ['name', 'phone', 'note', 'createdAt'],
      rows: customers.map((c) => [c.name, c.phone, c.note, c.createdAt]),
    }
  }

  if (entity === 'sales') {
    const sales = await prisma.sale.findMany({
      where: { shopId, deletedAt: null },
      include: { customer: true, device: true },
      orderBy: { createdAt: 'desc' },
    })
    return {
      headers: [
        'customer',
        'phone',
        'device',
        'salePrice',
        'amountPaid',
        'remainingAmount',
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
        s.amountPaid.toString(),
        s.remainingAmount.toString(),
        paymentMethodLabel(s.paymentMethod),
        s.paidFully,
        s.dueDate,
        s.createdAt,
      ]),
    }
  }

  if (entity === 'nasiya') {
    const nasiyalar = await prisma.nasiya.findMany({
      where: { shopId, deletedAt: null },
      include: { customer: true, device: true },
      orderBy: { createdAt: 'desc' },
    })
    return {
      headers: [
        'customer',
        'phone',
        'device',
        'totalAmount',
        'downPayment',
        'remainingAmount',
        'months',
        'status',
        'createdAt',
      ],
      rows: nasiyalar.map((n) => [
        n.customer.name,
        n.customer.phone,
        n.device.model,
        n.totalAmount.toString(),
        n.downPayment.toString(),
        n.remainingAmount.toString(),
        n.months,
        nasiyaStatusLabel(n.status),
        n.createdAt,
      ]),
    }
  }

  if (entity === 'returns') {
    const returns = await prisma.deviceReturn.findMany({
      where: { shopId },
      include: {
        device: true,
        sale: { include: { customer: true } },
        nasiya: { include: { customer: true } },
      },
      orderBy: { createdAt: 'desc' },
    })
    return {
      headers: [
        'device',
        'imei',
        'customer',
        'refundAmount',
        'refundMethod',
        'note',
        'createdAt',
      ],
      rows: returns.map((item) => [
        item.device.model,
        item.device.imei,
        item.sale?.customer.name ?? item.nasiya?.customer.name ?? '',
        item.refundAmount.toString(),
        paymentMethodLabel(item.refundMethod),
        item.note,
        item.createdAt,
      ]),
    }
  }

  if (entity === 'logs') {
    const logs = await prisma.log.findMany({
      where: {
        shopId,
        ...(role === 'SHOP_ADMIN' ? { actorType: 'SHOP_ADMIN' as const } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 1000,
    })
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
}
