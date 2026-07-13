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

// Client-side pool size for the pg driver adapter.
// max:1 serializes every Promise.all onto one connection (each query waits for
// the previous — a big latency multiplier over a remote Supabase link). The app
// connects through Supabase's transaction pooler (pgbouncer, port 6543), which
// multiplexes to Postgres, so a modest per-instance pool is safe and lets
// independent queries run concurrently. Tunable via DATABASE_POOL_MAX; set it
// against your Supabase pooler pool_size (total ≈ instances × max). Set to 1 to
// restore the old serialized behavior. Clamp to a conservative range so a
// mistyped env var cannot exhaust the Supabase pooler.
const parsedPoolMax = Number(process.env.DATABASE_POOL_MAX)
const requestedPoolMax = Number.isFinite(parsedPoolMax) && parsedPoolMax > 0 ? Math.floor(parsedPoolMax) : 5
const poolMax = Math.min(Math.max(requestedPoolMax, 1), 20)

function createPrismaClient() {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString, max: poolMax }) }).$extends({
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

// Keep the public type compatible with Prisma.TransactionClient annotations
// used throughout route handlers. The runtime instance still carries the
// request-audit query extension above.
export const prisma: PrismaClient = global.prisma ?? createPrismaClient() as unknown as PrismaClient

if (process.env.NODE_ENV !== 'production') {
  global.prisma = prisma
}
