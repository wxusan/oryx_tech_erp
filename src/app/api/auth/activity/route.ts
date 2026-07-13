import { requireApiSession } from '@/lib/api-auth'

/**
 * Records real super-admin browser activity in the durable session record.
 * Shop sessions do not need a heartbeat because shop inactivity logout is
 * intentionally disabled; their ordinary requests keep the rolling session
 * alive.
 */
export async function POST() {
  const guarded = await requireApiSession()
  if (!guarded.ok) return guarded.response
  return new Response(null, { status: 204 })
}
