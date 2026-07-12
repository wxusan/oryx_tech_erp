import 'server-only'

import type { Session } from 'next-auth'
import type { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { navigationDomains, type NavigationDomain } from '@/lib/navigation-cache-policy'
import { coalesceSyncEvents } from '@/lib/sync-contract'

export const CHANGE_EVENT_RETENTION_DAYS = 7
export const CHANGE_EVENT_BATCH_MAX = 100

export type ChangeOperation = 'created' | 'updated' | 'deleted' | 'aggregate-invalidated'

export interface ChangeEventDto {
  cursor: string
  domain: NavigationDomain
  entityType: string
  entityId: string
  operation: ChangeOperation
  mutationKind: string
  entityVersion: string
  affectedDomains: NavigationDomain[]
}

type AllowedScope = {
  scopeType: string
  scopeId: string
  domains?: NavigationDomain[]
}

const domainSet = new Set<string>(navigationDomains)

export function isNavigationDomain(value: string): value is NavigationDomain {
  return domainSet.has(value)
}

function allowedScopes(session: Session): AllowedScope[] {
  if (session.user.role === 'SHOP_ADMIN') {
    if (!session.user.shopId) return []
    return [
      { scopeType: 'SHOP', scopeId: session.user.shopId },
      // Currency-rate changes contain no tenant data and affect every shop.
      { scopeType: 'GLOBAL', scopeId: 'GLOBAL', domains: ['currency'] },
    ]
  }
  return [
    { scopeType: 'GLOBAL', scopeId: 'GLOBAL' },
    { scopeType: 'ADMIN', scopeId: session.user.id },
  ]
}

function scopeWhere(session: Session, requestedDomains?: readonly NavigationDomain[]): Prisma.ChangeEventWhereInput {
  const requested = requestedDomains?.length ? new Set(requestedDomains) : null
  const OR = allowedScopes(session).flatMap((scope) => {
    const permitted = scope.domains
      ? scope.domains.filter((domain) => !requested || requested.has(domain))
      : requestedDomains
    if (scope.domains && permitted?.length === 0) return []
    return [{
      scopeType: scope.scopeType,
      scopeId: scope.scopeId,
      ...(permitted?.length ? { domain: { in: [...permitted] } } : {}),
    }]
  })
  return OR.length ? { OR } : { sequence: { lt: BigInt(0) } }
}

export async function latestChangeCursorForSession(session: Session): Promise<string> {
  const latest = await prisma.changeEvent.aggregate({
    where: scopeWhere(session),
    _max: { sequence: true },
  })
  return (latest._max.sequence ?? BigInt(0)).toString()
}

export async function latestChangeCursorForShop(shopId: string): Promise<string> {
  const latest = await prisma.changeEvent.aggregate({
    where: { scopeType: 'SHOP', scopeId: shopId },
    _max: { sequence: true },
  })
  return (latest._max.sequence ?? BigInt(0)).toString()
}

export function affectedDomainsForChange(entityType: string, primary: NavigationDomain): NavigationDomain[] {
  const byEntity: Record<string, NavigationDomain[]> = {
    Device: ['devices', 'reports', 'logs'],
    Sale: ['devices', 'sales', 'payments', 'customers', 'reports', 'logs', 'overdue'],
    SalePayment: ['devices', 'sales', 'payments', 'customers', 'reports', 'logs', 'overdue'],
    Nasiya: ['devices', 'nasiyas', 'payments', 'customers', 'reports', 'logs', 'overdue'],
    NasiyaPayment: ['devices', 'nasiyas', 'payments', 'customers', 'reports', 'logs', 'overdue'],
    NasiyaReminder: ['nasiyas', 'logs', 'overdue'],
    Customer: ['customers', 'nasiyas', 'sales', 'reports', 'logs'],
    DeviceReturn: ['devices', 'sales', 'nasiyas', 'returns', 'reports', 'logs', 'overdue'],
    SupplierPayable: ['olibSotdim', 'devices', 'sales', 'payments', 'reports', 'logs'],
    CurrencyRate: ['currency', 'devices', 'sales', 'nasiyas', 'payments', 'customers', 'olibSotdim', 'reports', 'settings'],
    Shop: ['adminShops', 'adminPayments', 'adminReports', 'adminLogs', 'adminOps'],
    ShopAdmin: ['adminShops', 'adminLogs', 'adminOps'],
    SuperAdmin: ['settings', 'adminLogs'],
  }
  return [...new Set([primary, ...(byEntity[entityType] ?? ['logs'])])]
}

export async function readChangeEventBatch(input: {
  session: Session
  cursor: bigint
  domains?: readonly NavigationDomain[]
  limit?: number
}) {
  const limit = Math.min(Math.max(input.limit ?? CHANGE_EVENT_BATCH_MAX, 1), CHANGE_EVENT_BATCH_MAX)
  const [globalOldest, rows] = await Promise.all([
    prisma.changeEvent.findFirst({ orderBy: { sequence: 'asc' }, select: { sequence: true } }),
    prisma.changeEvent.findMany({
      where: {
        AND: [scopeWhere(input.session, input.domains), { sequence: { gt: input.cursor } }],
      },
      orderBy: { sequence: 'asc' },
      take: limit + 1,
      select: {
        sequence: true,
        domain: true,
        entityType: true,
        entityId: true,
        operation: true,
        mutationKind: true,
        entityVersion: true,
      },
    }),
  ])

  const resetRequired = input.cursor > BigInt(0)
    && globalOldest != null
    && input.cursor + BigInt(1) < globalOldest.sequence
  if (resetRequired) {
    const latestAllowed = await prisma.changeEvent.aggregate({
      where: scopeWhere(input.session, input.domains),
      _max: { sequence: true },
    })
    return {
      resetRequired: true,
      events: [] as ChangeEventDto[],
      nextCursor: (latestAllowed._max.sequence ?? input.cursor).toString(),
      hasMore: false,
      databaseQueryCount: 3,
    }
  }

  const hasMore = rows.length > limit
  const page = rows.slice(0, limit)
  const events: ChangeEventDto[] = []
  for (const row of page) {
    if (!isNavigationDomain(row.domain)) continue
    const operation = row.operation as ChangeOperation
    const event: ChangeEventDto = {
      cursor: row.sequence.toString(),
      domain: row.domain,
      entityType: row.entityType,
      entityId: row.entityId,
      operation,
      mutationKind: row.mutationKind,
      entityVersion: row.entityVersion.toISOString(),
      affectedDomains: affectedDomainsForChange(row.entityType, row.domain),
    }
    events.push(event)
  }

  return {
    resetRequired: false,
    events: coalesceSyncEvents(events),
    nextCursor: (page.at(-1)?.sequence ?? input.cursor).toString(),
    hasMore,
    databaseQueryCount: 2,
  }
}

export async function cleanupExpiredChangeEvents(now = new Date()) {
  const cutoff = new Date(now.getTime() - CHANGE_EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1000)
  return prisma.changeEvent.deleteMany({ where: { createdAt: { lt: cutoff } } })
}
