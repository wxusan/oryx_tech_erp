import { NextRequest } from 'next/server'
import { requireApiSession } from '@/lib/api-auth'
import { logger } from '@/lib/logger'
import { getShopDeviceListItemsByIds } from '@/lib/server/shop-lists'
import {
  CHANGE_EVENT_BATCH_MAX,
  latestChangeCursorForSession,
  readChangeEventBatch,
} from '@/lib/server/change-events'
import {
  emptyIncrementalSyncResponse,
  parseNavigationDomains,
  parseSyncCursor,
  type IncrementalSyncResponse,
} from '@/lib/sync-contract'
import { prisma } from '@/lib/prisma'
import { principalHasPermission } from '@/lib/server/shop-access'
import type { NavigationDomain } from '@/lib/navigation-cache-policy'

const PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  Vary: 'Cookie',
}

function allowedDomainsForGuard(guarded: Awaited<ReturnType<typeof requireApiSession>>): NavigationDomain[] | undefined {
  if (!guarded.ok || guarded.session.user.role === 'SUPER_ADMIN' || !guarded.principal) return undefined
  if (guarded.principal.memberKind === 'SHOP_OWNER') return undefined
  const domains = new Set<NavigationDomain>(['access', 'settings', 'currency'])
  const allow = (permission: Parameters<typeof principalHasPermission>[1], values: NavigationDomain[]) => {
    if (principalHasPermission(guarded.principal!, permission)) values.forEach((value) => domains.add(value))
  }
  allow('INVENTORY_VIEW', ['devices', 'sales', 'returns'])
  allow('CUSTOMER_VIEW', ['customers'])
  allow('NASIYA_VIEW', ['nasiyas'])
  allow('OLIB_VIEW', ['olibSotdim'])
  allow('PAYMENT_RECEIVE', ['payments', 'overdue'])
  allow('REPORT_VIEW', ['reports'])
  allow('LOG_VIEW', ['logs'])
  return [...domains]
}

export async function GET(request: NextRequest) {
  const startedAt = performance.now()
  const guarded = await requireApiSession()
  if (!guarded.ok) return guarded.response

  try {
    const rawCursor = request.nextUrl.searchParams.get('cursor')
    const cursor = parseSyncCursor(rawCursor)
    const requestedDomains = parseNavigationDomains(request.nextUrl.searchParams.get('domains'))
    const permittedDomains = allowedDomainsForGuard(guarded)
    const effectiveDomains = permittedDomains
      ? (requestedDomains?.length
          ? requestedDomains.filter((domain) => permittedDomains.includes(domain))
          : permittedDomains)
      : requestedDomains
    const requestedLimit = Number(request.nextUrl.searchParams.get('limit') ?? CHANGE_EVENT_BATCH_MAX)
    const limit = Number.isFinite(requestedLimit) ? Math.trunc(requestedLimit) : CHANGE_EVENT_BATCH_MAX

    // Cursorless requests are a race-safe bootstrap: authenticated layouts
    // normally provide a cursor captured before their child data resolves.
    if (cursor == null) {
      const nextCursor = await latestChangeCursorForSession(guarded.session, effectiveDomains)
      const response = emptyIncrementalSyncResponse(nextCursor)
      const responseSizeBytes = new TextEncoder().encode(JSON.stringify(response)).byteLength
      logger.info('incremental sync bootstrap completed', {
        event: 'sync.bootstrap',
        durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
        responseSizeBytes,
        databaseQueryCount: 1,
      })
      return Response.json(response, { headers: PRIVATE_HEADERS })
    }

    const batch = await readChangeEventBatch({
      session: guarded.session,
      cursor,
      domains: effectiveDomains,
      limit,
    })

    const directDeviceIds = batch.events
      .filter((event) => event.entityType === 'Device' && event.operation !== 'deleted')
      .map((event) => event.entityId)
    const saleIds = batch.events.filter((event) => event.entityType === 'Sale').map((event) => event.entityId)
    const nasiyaIds = batch.events.filter((event) => event.entityType === 'Nasiya').map((event) => event.entityId)
    const payableIds = batch.events.filter((event) => event.entityType === 'SupplierPayable').map((event) => event.entityId)
    const [sales, nasiyas, payables] = guarded.shopId
      ? await Promise.all([
          saleIds.length ? prisma.sale.findMany({
            where: { shopId: guarded.shopId, id: { in: saleIds } },
            select: { deviceId: true },
          }) : Promise.resolve([]),
          nasiyaIds.length ? prisma.nasiya.findMany({
            where: { shopId: guarded.shopId, id: { in: nasiyaIds } },
            select: { deviceId: true },
          }) : Promise.resolve([]),
          payableIds.length ? prisma.supplierPayable.findMany({
            where: { shopId: guarded.shopId, id: { in: payableIds } },
            select: { deviceId: true },
          }) : Promise.resolve([]),
        ])
      : [[], [], []]
    const deviceIds = [...new Set([
      ...directDeviceIds,
      ...sales.map((row) => row.deviceId),
      ...nasiyas.map((row) => row.deviceId),
      ...payables.map((row) => row.deviceId),
    ])]
    const devices = guarded.shopId
      ? await getShopDeviceListItemsByIds(guarded.shopId, deviceIds)
      : []
    const tombstones = batch.events
      .filter((event) => event.operation === 'deleted')
      .map((event) => ({ entityType: event.entityType, entityId: event.entityId }))
    const visibleDomainSet = permittedDomains ? new Set(permittedDomains) : null
    const visibleEvents = visibleDomainSet
      ? batch.events.map((event) => ({
          ...event,
          affectedDomains: event.affectedDomains.filter((domain) => visibleDomainSet.has(domain)),
        }))
      : batch.events
    const invalidatedDomains = [...new Set(visibleEvents.flatMap((event) => event.affectedDomains))]
    const eventQueryCount = batch.databaseQueryCount
    const publicBatch = {
      resetRequired: batch.resetRequired,
      nextCursor: batch.nextCursor,
      hasMore: batch.hasMore,
    }
    const relatedQueryCount = Number(saleIds.length > 0) + Number(nasiyaIds.length > 0) + Number(payableIds.length > 0)
    const databaseQueryCount = eventQueryCount + relatedQueryCount + Number(deviceIds.length > 0)
    const response: IncrementalSyncResponse = {
      ...publicBatch,
      events: visibleEvents,
      upserts: { devices },
      tombstones,
      invalidatedDomains,
    }
    const durationMs = Math.round((performance.now() - startedAt) * 10) / 10
    const responseSizeBytes = new TextEncoder().encode(JSON.stringify(response)).byteLength
    logger.info('incremental sync completed', {
      event: 'sync.delta',
      durationMs,
      eventCount: batch.events.length,
      deviceUpsertCount: devices.length,
      resetRequired: batch.resetRequired,
      hasMore: batch.hasMore,
      responseSizeBytes,
      databaseQueryCount,
    })
    return Response.json(response, {
      headers: { ...PRIVATE_HEADERS, 'Server-Timing': `sync;dur=${durationMs}` },
    })
  } catch (error) {
    if (error instanceof Error && ['INVALID_SYNC_CURSOR', 'INVALID_SYNC_DOMAINS'].includes(error.message)) {
      return Response.json({ error: 'Sinxronlash so\'rovi noto\'g\'ri' }, { status: 400, headers: PRIVATE_HEADERS })
    }
    logger.error('incremental sync failed', { event: 'sync.failed', error })
    return Response.json({ error: 'Sinxronlash amalga oshmadi' }, { status: 500, headers: PRIVATE_HEADERS })
  }
}
