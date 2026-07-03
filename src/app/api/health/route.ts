/**
 * GET /api/health — public liveness/readiness probe.
 *
 * Intentionally minimal: ok flag, timestamp, short commit, and a database
 * reachability boolean. No queue counts, shop data, or secrets — detailed ops
 * data lives behind the super-admin `/api/admin/ops` endpoint.
 */

import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'

function commit(): string {
  return (
    process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ??
    process.env.NEXT_PUBLIC_COMMIT_SHA?.slice(0, 7) ??
    'unknown'
  )
}

export async function GET(): Promise<Response> {
  let database = false
  try {
    await prisma.$queryRaw`SELECT 1`
    database = true
  } catch (error) {
    logger.error('health check database probe failed', { event: 'health.db_failed', route: '/api/health', error })
  }

  const ok = database
  return Response.json(
    {
      ok,
      timestamp: new Date().toISOString(),
      commit: commit(),
      database: database ? 'ok' : 'fail',
    },
    { status: ok ? 200 : 503 },
  )
}
