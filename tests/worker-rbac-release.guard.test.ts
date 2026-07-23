import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SHOP_FEATURE_CODES } from '@/lib/access-control'
import {
  STAFF_LOGS_PERMISSION,
  createShopStaffSchema,
  legacyStaffPermissionCodes,
  updateShopStaffSchema,
  withStaffLogsPermission,
} from '@/lib/shop-staff-contract'
import { redactShopStaffLogValue } from '@/lib/log-financial-redaction'
import { redactShopStaffCustomerProfileMetrics } from '@/lib/customer-profile-visibility'

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

describe('worker log-access contract', () => {
  const validCreate = {
    name: 'Test xodim',
    phone: '+998 90 123 45 67',
    login: 'test_staff',
    password: 'safe-password',
  }

  it('defaults every new worker capability and Telegram delivery to off', () => {
    const parsed = createShopStaffSchema.parse(validCreate)
    expect(parsed.logsViewEnabled).toBe(false)
    expect(parsed.telegramNotificationsEnabled).toBe(false)
    expect(parsed.permissionCodes).toEqual([])
    expect(parsed.permissionCodes).not.toContain(STAFF_LOGS_PERMISSION)
    expect(createShopStaffSchema.safeParse({ ...validCreate, permissionCodes: [STAFF_LOGS_PERMISSION] }).success).toBe(false)
  })

  it('materializes and revokes the same typed LOG_VIEW permission without changing other grants', () => {
    expect(withStaffLogsPermission(['INVENTORY_VIEW'], true)).toEqual(['INVENTORY_VIEW', STAFF_LOGS_PERMISSION])
    expect(withStaffLogsPermission(['INVENTORY_VIEW', STAFF_LOGS_PERMISSION], false)).toEqual(['INVENTORY_VIEW'])
    expect(updateShopStaffSchema.parse({
      staffId: 'staff-1',
      logsViewEnabled: false,
      note: 'Log ruxsati bekor qilindi',
    }).logsViewEnabled).toBe(false)
  })

  it('keeps legacy workers operational while excluding all owner-only analytics and resolution powers', () => {
    const permissions = legacyStaffPermissionCodes(new Set(SHOP_FEATURE_CODES))
    expect(permissions).toContain(STAFF_LOGS_PERMISSION)
    expect(permissions).not.toContain('REPORT_VIEW')
    expect(permissions).not.toContain('EXPORT_DATA')
    expect(permissions).not.toContain('WRITEOFF_MANAGE')
  })
})

describe('worker server boundary release guard', () => {
  it('uses an exact-capability server landing page and never renders an unauthorized dashboard', () => {
    const landing = source('src/app/(shop)/shop/page.tsx')
    const dashboard = source('src/app/(shop)/shop/dashboard/page.tsx')
    const login = source('src/components/auth/role-login-form.tsx')
    expect(landing).toContain('const destinations: Array<{ href: string; permissions: ShopPermissionCode[] }>')
    expect(landing).toContain("principalHasPermission(guarded.principal!, permission)")
    expect(landing).toContain("destination?.href ?? '/shop/settings'")
    expect(dashboard).toContain("principalHasPermission(guarded.principal, 'DASHBOARD_OPERATIONAL_VIEW')")
    expect(dashboard).toContain("principalHasPermission(guarded.principal, 'DASHBOARD_FINANCIAL_VIEW')")
    expect(login).toContain("const fallbackUrl = mode === 'admin' ? '/admin' : '/shop'")
  })

  it('bootstraps only the exact dashboard and receivables domains a worker can use', () => {
    const layout = source('src/app/(shop)/layout.tsx')
    const navigation = source('src/app/(shop)/shop-layout-client.tsx')
    const sync = source('src/app/api/sync/route.ts')
    expect(layout).toContain("principalHasPermission(guarded.principal, 'RECEIVABLES_VIEW')")
    expect(layout).toContain("principalHasPermission(guarded.principal, 'SALE_PAYMENT_RECEIVE')")
    expect(navigation).toContain("'RECEIVABLES_VIEW'")
    expect(navigation).toContain("'NASIYA_DEFER'")
    expect(sync).toContain("allow(['DASHBOARD_OPERATIONAL_VIEW', 'DASHBOARD_FINANCIAL_VIEW', 'REPORT_VIEW'], ['reports'], 'REPORTS')")
    expect(sync).toContain("], ['overdue'])")
  })

  it('keeps worker settings personal-only and enforces Telegram authorization in the route handler', () => {
    const api = source('src/app/api/shop-admin/profile/route.ts')
    const page = source('src/app/(shop)/shop/settings/settings-client.tsx')
    expect(api).toContain('function profileDto(')
    expect(api).toContain('telegramAllowed')
    expect(api).toContain('linkShopAdminTelegramIdentityInTransaction')
    expect(api).toContain('unlinkShopAdminTelegramIdentityInTransaction')
    expect(api).toContain('if (isStaff) {\n        return forbidden("Xodim ism yoki telefonini o\'zgartira olmaydi')
    expect(page).toContain('const isStaff = memberKind === \'SHOP_STAFF\'')
    expect(page).toContain('(settings.profile.telegramAllowed || Boolean(settings.profile.telegramId))')
    expect(page).toContain('{canManageShop && settings.shop && (')
  })

  it('filters RESTOCK from every shop-log response while retaining the underlying audit event', () => {
    const api = source('src/app/api/logs/route.ts')
    const bootstrap = source('src/lib/server/shop-lists.ts')
    const link = source('src/app/api/logs/[id]/link/route.ts')
    expect(api).toContain("NOT: { action: 'RESTOCK', targetType: 'Device' }")
    expect(bootstrap).toContain("NOT: { action: 'RESTOCK', targetType: 'Device' }")
    expect(link).toContain("NOT: { action: 'RESTOCK', targetType: 'Device' }")
  })

  it('redacts owner financial fields from a staff log JSON value without removing an authorized individual payment', () => {
    const safe = redactShopStaffLogValue({
      purchasePrice: 5_000_000,
      profit: 850_000,
      salePrice: 5_850_000,
      amountPaid: 2_000_000,
      nested: {
        contractPurchasePrice: 400,
        contractProfit: 70,
        remainingAmount: 200,
      },
    }) as Record<string, unknown>

    expect(safe).toEqual({
      salePrice: 5_850_000,
      amountPaid: 2_000_000,
      nested: { remainingAmount: 200 },
    })
  })

  it('redacts customer lifetime cash-flow and profit aggregates while retaining the worker debt queue', () => {
    expect(redactShopStaffCustomerProfileMetrics({
      contractValue: { UZS: 1_000_000, USD: 0 },
      dueThisMonth: { UZS: 250_000, USD: 0 },
      overdue: { UZS: 100_000, USD: 0 },
      cashCollected: { UZS: 750_000, USD: 0 },
      refunds: { UZS: 10_000, USD: 0 },
      writeOffs: { UZS: 20_000, USD: 0 },
      accountingAccrualGrossProfitUzs: 300_000,
      nasiyaInterestUzs: 50_000,
      legacyUsdPaymentCount: 1,
    })).toEqual({
      contractValue: { UZS: 1_000_000, USD: 0 },
      dueThisMonth: { UZS: 250_000, USD: 0 },
      overdue: { UZS: 100_000, USD: 0 },
    })
  })

  it('redacts cost and margin before device, Olib-sotdim, logs, and sync payloads reach a worker cache', () => {
    const devicesApi = source('src/app/api/devices/route.ts')
    const deviceDetailApi = source('src/app/api/devices/[id]/route.ts')
    const deviceLists = source('src/lib/server/shop-lists.ts')
    const sync = source('src/app/api/sync/route.ts')
    const olib = source('src/app/api/olib-sotdim/route.ts')
    const logs = source('src/app/api/logs/route.ts')
    const logsBootstrap = source('src/app/(shop)/shop/logs/page.tsx')

    expect(devicesApi).toContain('const includeOwnerFinancials =')
    expect(devicesApi).toContain('...(includeOwnerFinancials ? { purchasePrice: Number(purchasePrice) } : {})')
    expect(deviceDetailApi).toContain('STAFF_HIDDEN_DEVICE_DETAIL_FIELDS')
    expect(deviceLists).toContain('function redactShopDeviceOwnerFinancials')
    expect(deviceLists).toContain('visibility.includeOwnerFinancials ? item : redactShopDeviceOwnerFinancials(item)')
    expect(sync).toContain('getShopDeviceListItemsByIds(guarded.shopId, deviceIds, { includeOwnerFinancials })')
    expect(olib).toContain('...(includeOwnerFinancials ? {\n              purchasePrice:')
    expect(olib).toContain('...(includeOwnerFinancials && customerOutcome ? {')
    expect(olib).toContain('profit: customerOutcome.type === \'SALE\'')
    expect(olib).toContain('const response = {\n      operationId: result.operation.id,')
    expect(logs).toContain('const isShopStaff =')
    expect(logs).toContain('redactShopStaffLogValue(log.newValue)')
    expect(logsBootstrap).toContain('includeOwnerFinancials: guarded.principal?.memberKind === \'SHOP_OWNER\'')
  })

  it('keeps customer-profile financial aggregates and resolution history owner-only at both API and UI boundaries', () => {
    const profileApi = source('src/app/api/customers/[id]/profile/route.ts')
    const analyticsApi = source('src/app/api/customers/[id]/analytics/route.ts')
    const profileData = source('src/lib/server/customer-profile.ts')
    const analyticsData = source('src/lib/server/customer-profile-analytics.ts')
    const profileHistory = source('src/app/(shop)/shop/mijozlar/[id]/customer-profile-history.tsx')
    expect(profileApi).toContain('const includeOwnerFinancials =')
    expect(profileApi).toContain("!includeOwnerFinancials && section === 'resolutions'")
    expect(profileData).toContain('redactShopStaffCustomerProfileMetrics(metrics)')
    expect(analyticsApi).toContain('includeOwnerFinancials')
    expect(analyticsData).toContain('redactShopStaffCustomerProfileAnalytics')
    expect(profileHistory).toContain(".filter((candidate) => canSeeOwnerFinancials || candidate !== 'resolutions')")
  })

  it('returns Nasiya resolution data only to owners or an exact resolution capability', () => {
    const nasiyaDetail = source('src/app/api/nasiya/[id]/route.ts')
    const nasiyaList = source('src/app/api/nasiya/route.ts')
    const nasiyaPage = source('src/app/(shop)/shop/nasiyalar/page.tsx')
    const nasiyaClient = source('src/app/(shop)/shop/nasiyalar/nasiyalar-client.tsx')
    expect(nasiyaDetail).toContain('const includeResolutionData =')
    expect(nasiyaDetail).toContain("['NASIYA_ARCHIVE', 'NASIYA_REOPEN']")
    expect(nasiyaDetail).toContain('...(includeResolutionData')
    expect(nasiyaList).toContain('if (resolutionState && !includeResolutionData)')
    expect(nasiyaPage).toContain("!canViewResolutionHistory && requestedFilter === 'ARCHIVED'")
    expect(nasiyaClient).toContain("canViewResolutionHistory || tab.value !== 'ARCHIVED'")
  })

  it('limits cost/margin Telegram templates to the shop owner recipient', () => {
    const deviceCreate = source('src/app/api/devices/route.ts')
    const deviceSell = source('src/app/api/devices/[id]/sell/route.ts')
    const olib = source('src/app/api/olib-sotdim/route.ts')
    expect(deviceCreate).toContain('audience: TELEGRAM_AUDIENCES.OWNER_ONLY')
    expect(deviceSell).toContain('audience: TELEGRAM_AUDIENCES.OWNER_ONLY')
    expect(olib).toContain('audience: TELEGRAM_AUDIENCES.OWNER_ONLY')
  })
})
