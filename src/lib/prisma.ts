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

export const prisma: PrismaClient =
  global.prisma ?? new PrismaClient({ adapter: new PrismaPg({ connectionString, max: 1 }) })

if (process.env.NODE_ENV !== 'production') {
  global.prisma = prisma
}
