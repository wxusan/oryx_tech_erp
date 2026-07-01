import { NextRequest } from 'next/server'
import { requireApiSession, resolveActiveShopId } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'

type RouteContext = { params: Promise<{ entity: string }> }

function csvValue(value: unknown) {
  const raw = value instanceof Date ? value.toISOString() : value == null ? '' : String(value)
  return `"${raw.replaceAll('"', '""')}"`
}

function csv(headers: string[], rows: unknown[][]) {
  return [headers, ...rows].map((row) => row.map(csvValue).join(',')).join('\n')
}

function csvResponse(entity: string, body: string) {
  return new Response(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${entity}.csv"`,
    },
  })
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  const guarded = await requireApiSession()
  if (!guarded.ok) return guarded.response
  const { session } = guarded
  const { entity } = await ctx.params

  const resolved = await resolveActiveShopId(session, req.nextUrl.searchParams.get('shopId'))
  if (!resolved.ok) return resolved.response
  const { shopId } = resolved

  if (entity === 'devices') {
    const devices = await prisma.device.findMany({
      where: { shopId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    })
    return csvResponse(entity, csv(
      ['model', 'imei', 'color', 'storage', 'batteryHealth', 'purchasePrice', 'status', 'createdAt'],
      devices.map((d) => [d.model, d.imei, d.color, d.storage, d.batteryHealth, d.purchasePrice, d.status, d.createdAt]),
    ))
  }

  if (entity === 'customers') {
    const customers = await prisma.customer.findMany({
      where: { shopId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    })
    return csvResponse(entity, csv(
      ['name', 'phone', 'note', 'createdAt'],
      customers.map((c) => [c.name, c.phone, c.note, c.createdAt]),
    ))
  }

  if (entity === 'sales') {
    const sales = await prisma.sale.findMany({
      where: { shopId, deletedAt: null },
      include: { customer: true, device: true },
      orderBy: { createdAt: 'desc' },
    })
    return csvResponse(entity, csv(
      ['customer', 'phone', 'device', 'salePrice', 'amountPaid', 'remainingAmount', 'paidFully', 'dueDate', 'createdAt'],
      sales.map((s) => [s.customer.name, s.customer.phone, s.device.model, s.salePrice, s.amountPaid, s.remainingAmount, s.paidFully, s.dueDate, s.createdAt]),
    ))
  }

  if (entity === 'nasiya') {
    const nasiyalar = await prisma.nasiya.findMany({
      where: { shopId, deletedAt: null },
      include: { customer: true, device: true },
      orderBy: { createdAt: 'desc' },
    })
    return csvResponse(entity, csv(
      ['customer', 'phone', 'device', 'totalAmount', 'downPayment', 'remainingAmount', 'months', 'status', 'createdAt'],
      nasiyalar.map((n) => [n.customer.name, n.customer.phone, n.device.model, n.totalAmount, n.downPayment, n.remainingAmount, n.months, n.status, n.createdAt]),
    ))
  }

  if (entity === 'logs') {
    const logs = await prisma.log.findMany({
      where: { shopId },
      orderBy: { createdAt: 'desc' },
      take: 1000,
    })
    return csvResponse(entity, csv(
      ['actorId', 'actorType', 'action', 'targetType', 'targetId', 'note', 'createdAt'],
      logs.map((log) => [log.actorId, log.actorType, log.action, log.targetType, log.targetId, log.note, log.createdAt]),
    ))
  }

  return new Response('Unknown export entity', { status: 404 })
}
