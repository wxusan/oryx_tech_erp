import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { NextRequest } from 'next/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const authMock = vi.hoisted(() => ({
  deny: vi.fn(async () => ({
    ok: false as const,
    response: Response.json({ error: 'Forbidden' }, { status: 403 }),
  })),
  guardBypass: vi.fn(async () => {
    throw new Error('Protected route continued after the authorization guard denied access')
  }),
}))

// Keep this mock completely isolated from the real auth module. Importing the
// original would initialize NextAuth before a Route Handler can be exercised,
// turning an authorization-boundary test into a framework-resolution test.
vi.mock('@/lib/api-auth', () => ({
  requireApiSession: authMock.deny,
  requireSuperAdmin: authMock.deny,
  requireShopPermission: authMock.deny,
  requireShopAnyPermission: authMock.deny,
  requireShopPermissionAndFeature: authMock.deny,
  requireShopPermissionAndAnyFeature: authMock.deny,
  requireCurrentShopPermission: authMock.deny,
  requireCurrentShopFeature: authMock.deny,
  requireReceivableView: authMock.deny,
  resolveActiveShopId: authMock.guardBypass,
  internalSecret: vi.fn(() => undefined),
  hasValidInternalSecret: vi.fn(() => false),
  internalFetchHeaders: vi.fn(() => ({})),
}))

type RouteModule = Partial<Record<'GET' | 'POST' | 'PATCH' | 'DELETE', (...args: never[]) => Promise<Response>>>

const routes: Array<{ path: string; load: () => Promise<RouteModule> }> = [
  { path: 'src/app/api/admin/currency-rate/route.ts', load: () => import('@/app/api/admin/currency-rate/route') },
  { path: 'src/app/api/admin/ops/route.ts', load: () => import('@/app/api/admin/ops/route') },
  { path: 'src/app/api/admin/payments/route.ts', load: () => import('@/app/api/admin/payments/route') },
  { path: 'src/app/api/admin/profile/route.ts', load: () => import('@/app/api/admin/profile/route') },
  { path: 'src/app/api/admin/reports/due-shops/route.ts', load: () => import('@/app/api/admin/reports/due-shops/route') },
  { path: 'src/app/api/auth/activity/route.ts', load: () => import('@/app/api/auth/activity/route') },
  { path: 'src/app/api/customers/[id]/passport/image/route.ts', load: () => import('@/app/api/customers/[id]/passport/image/route') },
  { path: 'src/app/api/customers/[id]/passport/reveal/route.ts', load: () => import('@/app/api/customers/[id]/passport/reveal/route') },
  { path: 'src/app/api/customers/[id]/profile/route.ts', load: () => import('@/app/api/customers/[id]/profile/route') },
  { path: 'src/app/api/customers/[id]/route.ts', load: () => import('@/app/api/customers/[id]/route') },
  { path: 'src/app/api/customers/by-phone/route.ts', load: () => import('@/app/api/customers/by-phone/route') },
  { path: 'src/app/api/customers/picker/route.ts', load: () => import('@/app/api/customers/picker/route') },
  { path: 'src/app/api/customers/route.ts', load: () => import('@/app/api/customers/route') },
  { path: 'src/app/api/customers/search/route.ts', load: () => import('@/app/api/customers/search/route') },
  { path: 'src/app/api/devices/[id]/nasiya/route.ts', load: () => import('@/app/api/devices/[id]/nasiya/route') },
  { path: 'src/app/api/devices/[id]/restock/route.ts', load: () => import('@/app/api/devices/[id]/restock/route') },
  { path: 'src/app/api/devices/[id]/return/route.ts', load: () => import('@/app/api/devices/[id]/return/route') },
  { path: 'src/app/api/devices/[id]/route.ts', load: () => import('@/app/api/devices/[id]/route') },
  { path: 'src/app/api/devices/[id]/sell/route.ts', load: () => import('@/app/api/devices/[id]/sell/route') },
  { path: 'src/app/api/devices/route.ts', load: () => import('@/app/api/devices/route') },
  { path: 'src/app/api/export/[entity]/route.ts', load: () => import('@/app/api/export/[entity]/route') },
  { path: 'src/app/api/import/customers/route.ts', load: () => import('@/app/api/import/customers/route') },
  { path: 'src/app/api/logs/[id]/link/route.ts', load: () => import('@/app/api/logs/[id]/link/route') },
  { path: 'src/app/api/logs/route.ts', load: () => import('@/app/api/logs/route') },
  { path: 'src/app/api/nasiya/[id]/defer/route.ts', load: () => import('@/app/api/nasiya/[id]/defer/route') },
  { path: 'src/app/api/nasiya/[id]/payment/route.ts', load: () => import('@/app/api/nasiya/[id]/payment/route') },
  { path: 'src/app/api/nasiya/[id]/reminder/route.ts', load: () => import('@/app/api/nasiya/[id]/reminder/route') },
  { path: 'src/app/api/nasiya/[id]/resolution/route.ts', load: () => import('@/app/api/nasiya/[id]/resolution/route') },
  { path: 'src/app/api/nasiya/[id]/route.ts', load: () => import('@/app/api/nasiya/[id]/route') },
  { path: 'src/app/api/nasiya/import/route.ts', load: () => import('@/app/api/nasiya/import/route') },
  { path: 'src/app/api/nasiya/route.ts', load: () => import('@/app/api/nasiya/route') },
  { path: 'src/app/api/olib-sotdim/[id]/pay/route.ts', load: () => import('@/app/api/olib-sotdim/[id]/pay/route') },
  { path: 'src/app/api/olib-sotdim/route.ts', load: () => import('@/app/api/olib-sotdim/route') },
  { path: 'src/app/api/receivables/route.ts', load: () => import('@/app/api/receivables/route') },
  { path: 'src/app/api/reports/shop/route.ts', load: () => import('@/app/api/reports/shop/route') },
  { path: 'src/app/api/sales/[id]/payment/route.ts', load: () => import('@/app/api/sales/[id]/payment/route') },
  { path: 'src/app/api/sales/[id]/route.ts', load: () => import('@/app/api/sales/[id]/route') },
  { path: 'src/app/api/shop-admin/profile/route.ts', load: () => import('@/app/api/shop-admin/profile/route') },
  { path: 'src/app/api/shop/profile/route.ts', load: () => import('@/app/api/shop/profile/route') },
  { path: 'src/app/api/shop/staff/[id]/route.ts', load: () => import('@/app/api/shop/staff/[id]/route') },
  { path: 'src/app/api/shop/staff/route.ts', load: () => import('@/app/api/shop/staff/route') },
  { path: 'src/app/api/shops/[id]/admins/route.ts', load: () => import('@/app/api/shops/[id]/admins/route') },
  { path: 'src/app/api/shops/[id]/owner/route.ts', load: () => import('@/app/api/shops/[id]/owner/route') },
  { path: 'src/app/api/shops/[id]/package/route.ts', load: () => import('@/app/api/shops/[id]/package/route') },
  { path: 'src/app/api/shops/[id]/payment/route.ts', load: () => import('@/app/api/shops/[id]/payment/route') },
  { path: 'src/app/api/shops/[id]/route.ts', load: () => import('@/app/api/shops/[id]/route') },
  { path: 'src/app/api/shops/route.ts', load: () => import('@/app/api/shops/route') },
  { path: 'src/app/api/stats/admin/route.ts', load: () => import('@/app/api/stats/admin/route') },
  { path: 'src/app/api/stats/due-overdue/route.ts', load: () => import('@/app/api/stats/due-overdue/route') },
  { path: 'src/app/api/stats/shop/route.ts', load: () => import('@/app/api/stats/shop/route') },
  { path: 'src/app/api/sync/route.ts', load: () => import('@/app/api/sync/route') },
  { path: 'src/app/api/uploads/device/route.ts', load: () => import('@/app/api/uploads/device/route') },
  { path: 'src/app/api/uploads/passport/route.ts', load: () => import('@/app/api/uploads/passport/route') },
]

const guardPattern = /require(?:ApiSession|SuperAdmin|ShopPermission|ShopAnyPermission|ShopPermissionAndFeature|CurrentShopPermission|ReceivableView)\s*\(/

function routeFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const fullPath = path.join(directory, entry)
    return statSync(fullPath).isDirectory()
      ? routeFiles(fullPath)
      : fullPath.endsWith('/route.ts') || fullPath.endsWith('route.ts') ? [fullPath] : []
  })
}

describe('exhaustive protected Route Handler denial matrix', () => {
  it('inventories every API route that declares a session, role, permission, or receivable guard', () => {
    const root = path.resolve('src/app/api')
    const discovered = routeFiles(root)
      .filter((file) => guardPattern.test(readFileSync(file, 'utf8')))
      .map((file) => path.relative(process.cwd(), file))
      .sort()
    expect(routes.map((route) => route.path).sort()).toEqual(discovered)
  })

  for (const route of routes) {
    it(`${route.path} rejects before protected handler logic runs`, async () => {
      const routeModule = await route.load()
      const methods = (['GET', 'POST', 'PATCH', 'DELETE'] as const)
        .filter((method) => typeof routeModule[method] === 'function')
      expect(methods.length).toBeGreaterThan(0)
      for (const method of methods) {
        authMock.deny.mockClear()
        const request = new NextRequest(`http://localhost/api/test?shopId=shop-other`, {
          method,
          ...(method === 'GET' ? {} : { body: JSON.stringify({}) }),
          headers: { 'content-type': 'application/json' },
        })
        const response = await routeModule[method]!(request as never, {
          params: Promise.resolve({ id: 'entity-id', entity: 'devices' }),
        } as never)
        expect(response.status).toBe(403)
        expect(authMock.deny).toHaveBeenCalled()
      }
    })
  }
})
