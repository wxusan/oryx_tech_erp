import { requireApiSession } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'

const SESSION_ROLLING_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000

/**
 * Records an explicit browser input event in the durable session record.
 * Polling, RSC rendering, sync, visibility changes, and ordinary API traffic
 * never call this route and therefore cannot keep an unattended session alive.
 */
export async function POST() {
  const guarded = await requireApiSession()
  if (!guarded.ok) return guarded.response
  const now = new Date()
  const update = await prisma.authSession.updateMany({
    where: {
      id: guarded.session.user.sessionId,
      actorId: guarded.session.user.id,
      actorType: guarded.session.user.role,
      revokedAt: null,
    },
    data: {
      lastSeenAt: now,
      lastUserActivityAt: now,
      ...(guarded.session.user.sessionPolicy === 'REMEMBERED_30_DAYS'
        ? { expiresAt: new Date(now.getTime() + SESSION_ROLLING_LIFETIME_MS) }
        : {}),
    },
  })
  if (update.count !== 1) return new Response(null, { status: 401 })
  return new Response(null, { status: 204 })
}
