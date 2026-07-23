/**
 * GET /api/nasiya?shopId=...&tab=...&status=...&search=...&skip=...&take=... — paginated nasiyalar list
 *
 * Auth: SHOP_ADMIN (scoped to their own shop) or SUPER_ADMIN (requires shopId param)
 * Returns { items, total, skip, take }, the same canonical bounded envelope as
 * /api/devices, /api/logs and /api/customers.
 *
 * The actual query/derivation/scoring logic lives in
 * `getShopNasiyalarList` (src/lib/server/shop-lists.ts) — reused as-is so the
 * list page's server-rendered first page and this client-fetch route never
 * drift apart.
 */

import { NextRequest } from 'next/server'
import { requireShopAnyPermission, resolveActiveShopId } from '@/lib/api-auth'
import { ok, badRequest, forbidden, serverError } from '@/lib/api-helpers'
import { logger } from '@/lib/logger'
import { getShopNasiyalarList, type NasiyaCohortFilter, type NasiyaStatusFilter } from '@/lib/server/shop-lists'
import { principalHasPermission } from '@/lib/server/shop-access'
import { prepareSearchNeedle } from '@/lib/search-needle'

const nasiyaStatuses = ['ACTIVE', 'COMPLETED', 'OVERDUE'] as const
const resolutionFilters = ['ARCHIVED'] as const
const cohortFilters = ['ACTIVE', 'OVERDUE', 'DUE_TODAY', 'UPCOMING'] as const

export async function GET(req: NextRequest) {
  try {
    const guarded = await requireShopAnyPermission([
      'NASIYA_VIEW',
      'NASIYA_EDIT',
      'NASIYA_RETURN_REFUND',
      'NASIYA_REMINDER_MANAGE',
      'NASIYA_ARCHIVE',
      'NASIYA_REOPEN',
    ])
    if (!guarded.ok) return guarded.response
    const { session } = guarded

    const { searchParams } = req.nextUrl

    const resolved = await resolveActiveShopId(session, searchParams.get('shopId'))
    if (!resolved.ok) return resolved.response
    const { shopId } = resolved

    // `tab` is the user-facing navigation contract. Keep `status` as a
    // backward-compatible API alias for existing links/bookmarks.
    const tabParam = searchParams.get('tab') ?? undefined
    const statusParam = tabParam ?? searchParams.get('status') ?? undefined
    if (
      statusParam &&
      !nasiyaStatuses.includes(statusParam as (typeof nasiyaStatuses)[number]) &&
      !resolutionFilters.includes(statusParam as (typeof resolutionFilters)[number]) &&
      !cohortFilters.includes(statusParam as (typeof cohortFilters)[number])
    ) {
      return badRequest("Nasiya statusi noto'g'ri")
    }
    const cohort = tabParam && cohortFilters.includes(statusParam as (typeof cohortFilters)[number])
      ? statusParam as NasiyaCohortFilter
      : undefined
    const resolutionState = resolutionFilters.includes(statusParam as (typeof resolutionFilters)[number])
      ? statusParam as (typeof resolutionFilters)[number]
      : undefined
    const includeResolutionData = session.user.role === 'SUPER_ADMIN' ||
      guarded.principal?.memberKind === 'SHOP_OWNER' || Boolean(
        guarded.principal && ['NASIYA_ARCHIVE', 'NASIYA_REOPEN'].some((permission) => (
          principalHasPermission(
            guarded.principal!,
            permission as 'NASIYA_ARCHIVE' | 'NASIYA_REOPEN',
          )
        )),
      )
    if (resolutionState && !includeResolutionData) {
      return forbidden("Arxivlangan nasiyalar uchun ruxsat berilmagan")
    }
    const status = resolutionState || cohort ? undefined : statusParam as NasiyaStatusFilter | undefined
    const preparedSearch = prepareSearchNeedle(searchParams.get('search'))
    if (preparedSearch.exceedsMaxLength) return badRequest('Qidiruv 100 ta belgidan oshmasligi kerak')
    const search = preparedSearch.query
    const requestedTake = Number(searchParams.get('take') ?? 25)
    const requestedSkip = Number(searchParams.get('skip') ?? 0)
    const take = Number.isFinite(requestedTake) ? Math.trunc(Math.min(Math.max(requestedTake, 1), 100)) : 25
    const skip = Number.isFinite(requestedSkip) ? Math.trunc(Math.max(requestedSkip, 0)) : 0

    const { items, total } = await getShopNasiyalarList(shopId, { search, status, cohort, resolutionState, skip, take })

    return ok({ items, total, skip, take }, "Nasiyalar ro'yxati")
  } catch (err) {
    logger.error('[GET /api/nasiya]', { event: 'api.route_error', error: err })
    return serverError()
  }
}
