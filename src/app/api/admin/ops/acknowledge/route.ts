/**
 * POST /api/admin/ops/acknowledge — start a fresh live-alert window.
 *
 * The underlying OpsEvent and Notification records are deliberately retained
 * for audit; only the Super Admin operations dashboard moves its alert
 * boundary forward so newly raised issues are immediately distinguishable.
 */

import { prisma } from '@/lib/prisma'
import { requireSuperAdmin } from '@/lib/api-auth'
import { ok, serverError } from '@/lib/api-helpers'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'

export async function POST() {
  try {
    const guarded = await requireSuperAdmin()
    if (!guarded.ok) return guarded.response

    const acknowledgedAt = new Date()
    await prisma.opsAlertState.upsert({
      where: { id: 'platform' },
      create: {
        id: 'platform',
        alertWindowStartsAt: acknowledgedAt,
        acknowledgedAt,
        acknowledgedById: guarded.session.user.id,
      },
      update: {
        alertWindowStartsAt: acknowledgedAt,
        acknowledgedAt,
        acknowledgedById: guarded.session.user.id,
      },
    })

    return ok({ acknowledgedAt }, 'Yangi tizim kuzatuv davri boshlandi')
  } catch (err) {
    logger.error('[POST /api/admin/ops/acknowledge]', { event: 'api.route_error', error: err })
    return serverError()
  }
}
