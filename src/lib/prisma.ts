/**
 * Prisma client singleton
 * Prevents multiple PrismaClient instances during Next.js hot reloads in development.
 *
 * NOTE: The client is generated to src/generated/prisma (see prisma/schema.prisma).
 * Run `npx prisma generate` before using this module.
 */

import { PrismaClient } from '@/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

declare global {
  var prisma: PrismaClient | undefined
}

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
// restore the old serialized behavior.
const parsedPoolMax = Number(process.env.DATABASE_POOL_MAX)
const poolMax = Number.isFinite(parsedPoolMax) && parsedPoolMax > 0 ? parsedPoolMax : 5

export const prisma: PrismaClient =
  global.prisma ?? new PrismaClient({ adapter: new PrismaPg({ connectionString, max: poolMax }) })

if (process.env.NODE_ENV !== 'production') {
  global.prisma = prisma
}
