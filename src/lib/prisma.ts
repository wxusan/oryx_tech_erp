/**
 * Prisma client singleton
 * Prevents multiple PrismaClient instances during Next.js hot reloads in development.
 *
 * NOTE: The client is generated to src/generated/prisma (see prisma/schema.prisma).
 * Run `npx prisma generate` before using this module.
 */

import { PrismaClient } from '@/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { currentBusinessLogContext, currentRequestAuditContext } from '@/lib/server/request-context'

function connectionStringForRuntime(): string {
  const connectionString =
    process.env.NODE_ENV === 'production'
      ? process.env.DATABASE_URL
      : process.env.DATABASE_URL ?? process.env.DIRECT_URL

  if (!connectionString) {
    throw new Error(
      process.env.NODE_ENV === 'production'
        ? 'DATABASE_URL is required for Prisma in production'
        : 'DATABASE_URL or DIRECT_URL is required for Prisma',
    )
  }
  return connectionString
}

function poolMaxForRuntime(): number {
  // Client-side pool size for the pg driver adapter. `max:1` serializes every
  // Promise.all onto one connection; this modest, bounded pool is safe behind
  // Supabase's transaction pooler and avoids needless local/production drift.
  const parsedPoolMax = Number(process.env.DATABASE_POOL_MAX)
  const requestedPoolMax = Number.isFinite(parsedPoolMax) && parsedPoolMax > 0 ? Math.floor(parsedPoolMax) : 5
  return Math.min(Math.max(requestedPoolMax, 1), 20)
}

function createPrismaClient() {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: connectionStringForRuntime(), max: poolMaxForRuntime() }),
  }).$extends({
    name: 'request-audit-context',
    query: {
      log: {
        create({ args, query }) {
          const context = currentBusinessLogContext()
          args.data.requestId ??= context.requestId
          args.data.ipAddress ??= context.ipAddress
          return query(args)
        },
      },
      opsEvent: {
        create({ args, query }) {
          args.data.requestId ??= currentRequestAuditContext()?.requestId ?? null
          return query(args)
        },
      },
    },
  })
}

declare global {
  var prisma: PrismaClient | undefined
}

function getPrisma(): PrismaClient {
  if (global.prisma) return global.prisma
  const client = createPrismaClient() as unknown as PrismaClient
  if (process.env.NODE_ENV !== 'production') global.prisma = client
  return client
}

/**
 * A lazy proxy keeps module evaluation build-safe. Next can import route/page
 * modules while collecting production metadata without requiring a live
 * database; the real client is constructed only when a request uses it.
 * The public shape remains `PrismaClient`, so existing route and transaction
 * code does not need a risky repository-wide rewrite.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = getPrisma() as unknown as Record<PropertyKey, unknown>
    const value = Reflect.get(client, property, client)
    return typeof value === 'function' ? value.bind(client) : value
  },
})
