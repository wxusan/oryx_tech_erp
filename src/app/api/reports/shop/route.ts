import { NextRequest } from 'next/server'
import { badRequest, ok, serverError } from '@/lib/api-helpers'
import { requireShopPermissionAndFeature, resolveActiveShopId } from '@/lib/api-auth'
import { logger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import { isMonthKey, resolveReportRange, type ReportRangePreset } from '@/lib/report-range'
import { getShopRangeReport, getShopReportDataMonths } from '@/lib/server/shop-report-range'
import { tashkentMonthRange } from '@/lib/timezone'

const PRESETS = new Set<ReportRangePreset>(['single', 'trailing3', 'trailing6', 'trailing12', 'custom'])

export async function GET(request: NextRequest) {
  try {
    const guarded = await requireShopPermissionAndFeature('REPORT_VIEW', 'REPORTS')
    if (!guarded.ok) return guarded.response

    const resolved = await resolveActiveShopId(guarded.session, request.nextUrl.searchParams.get('shopId'))
    if (!resolved.ok) return resolved.response
    const { shopId } = resolved

    const params = request.nextUrl.searchParams
    const presetValue = params.get('preset')?.trim() || 'single'
    if (!PRESETS.has(presetValue as ReportRangePreset)) return badRequest('Hisobot turi noto\'g\'ri')

    const month = params.get('month')?.trim() || null
    const startMonth = params.get('startMonth')?.trim() || null
    const endMonth = params.get('endMonth')?.trim() || null
    if (month && !isMonthKey(month)) return badRequest('Oy YYYY-MM formatida bo\'lishi kerak')
    if (startMonth && !isMonthKey(startMonth)) return badRequest('Boshlanish oyi noto\'g\'ri')
    if (endMonth && !isMonthKey(endMonth)) return badRequest('Yakun oyi noto\'g\'ri')

    const adminId = params.get('admin')?.trim() || null
    if (adminId) {
      const adminExists = await prisma.shopAdmin.count({
        where: { id: adminId, shopId, deletedAt: null },
      })
      if (!adminExists) return badRequest('Tanlangan admin bu do\'konga tegishli emas')
    }

    const availableMonths = await getShopReportDataMonths(shopId)
    const explicitRange = presetValue !== 'single' || Boolean(month)
    if (!availableMonths.length && !explicitRange) {
      return ok({ availableMonths, report: null })
    }
    if (presetValue === 'single' && month && !availableMonths.includes(month)) {
      return badRequest('Tanlangan oyda hisobot ma\'lumoti yo\'q')
    }

    let range
    try {
      range = resolveReportRange({
        preset: presetValue,
        month,
        startMonth,
        endMonth,
        defaultEndMonth: availableMonths[0] ?? tashkentMonthRange().monthKey,
      })
    } catch (error) {
      return badRequest(error instanceof Error ? error.message : 'Hisobot oralig\'i noto\'g\'ri')
    }
    if (!range.monthKeys.every((monthKey) => availableMonths.includes(monthKey))) {
      return badRequest("Tanlangan oraliq do'konning ERP ishlatilgan oylaridan tashqarida")
    }

    const report = await getShopRangeReport({ shopId, range, adminId })
    return ok({ availableMonths, report })
  } catch (error) {
    logger.error('[GET /api/reports/shop]', { event: 'api.route_error', error })
    return serverError()
  }
}
