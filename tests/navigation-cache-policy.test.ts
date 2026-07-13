import { describe, expect, it } from 'vitest'
import {
  NAVIGATION_CACHE_TTL_SECONDS,
  navigationImpactForMutation,
  navigationScopeForSession,
} from '@/lib/navigation-cache-policy'

describe('mutation-aware navigation cache policy', () => {
  it('uses the two-minute warm-navigation TTL', () => {
    expect(NAVIGATION_CACHE_TTL_SECONDS).toBe(120)
  })

  it('invalidates the device list, both stock selectors, dashboard, reports, and logs after creation', () => {
    const impact = navigationImpactForMutation({ kind: 'device.created', deviceId: 'device_1' })
    expect(impact.paths).toEqual(expect.arrayContaining([
      '/shop/qurilmalar',
      '/shop/qurilmalar/device_1',
      '/shop/sotuv/new',
      '/shop/nasiyalar/new',
      '/shop/dashboard',
      '/shop/hisobot',
      '/shop/logs',
    ]))
  })

  it('invalidates inventory, customer, dashboard, overdue, reports, and logs after a sale', () => {
    const impact = navigationImpactForMutation({ kind: 'sale.created', deviceId: 'device_2' })
    expect(impact.domains).toEqual(expect.arrayContaining(['devices', 'sales', 'customers', 'overdue']))
    expect(impact.paths).toEqual(expect.arrayContaining([
      '/shop/qurilmalar',
      '/shop/qurilmalar/device_2',
      '/shop/mijozlar',
      '/shop/dashboard',
      '/shop/hisobot',
      '/shop/logs',
    ]))
  })

  it('invalidates the nasiya list/detail, dashboard, and overdue data after payment', () => {
    const impact = navigationImpactForMutation({
      kind: 'nasiya.paymentRecorded',
      nasiyaId: 'nasiya_1',
      deviceId: 'device_3',
    })
    expect(impact.domains).toEqual(expect.arrayContaining(['nasiyas', 'payments', 'overdue']))
    expect(impact.paths).toEqual(expect.arrayContaining([
      '/shop/nasiyalar',
      '/shop/nasiyalar/nasiya_1',
      '/shop/qurilmalar/device_3',
      '/shop/dashboard',
    ]))
  })

  it('makes returned/restocked stock selectors fresh', () => {
    for (const kind of ['return.created', 'device.restocked'] as const) {
      const impact = navigationImpactForMutation({ kind, deviceId: 'device_4' })
      expect(impact.paths).toEqual(expect.arrayContaining([
        '/shop/qurilmalar',
        '/shop/sotuv/new',
        '/shop/nasiyalar/new',
      ]))
    }
  })

  it('invalidates every formatted financial surface for shop/global currency changes', () => {
    for (const kind of ['shop.currencyUpdated', 'currency.updated'] as const) {
      const impact = navigationImpactForMutation({ kind })
      expect(impact.domains).toContain('currency')
      expect(impact.paths).toEqual(expect.arrayContaining([
        '/shop/dashboard',
        '/shop/qurilmalar',
        '/shop/nasiyalar',
        '/shop/olib-sotdim',
        '/shop/hisobot',
      ]))
    }
  })

  it('invalidates admin list/detail, payment, report, log, and ops pages', () => {
    const impact = navigationImpactForMutation({ kind: 'admin.shopPaymentRecorded', shopId: 'shop_1' })
    expect(impact.paths).toEqual(expect.arrayContaining([
      '/admin',
      '/admin/shops',
      '/admin/shops/shop_1',
      '/admin/payments',
      '/admin/hisobot',
      '/admin/logs',
      '/admin/ops',
    ]))
  })

  it('never turns untrusted entity IDs into paths', () => {
    const impact = navigationImpactForMutation({ kind: 'device.updated', deviceId: '../admin' })
    expect(impact.paths).not.toContain('/shop/qurilmalar/../admin')
  })

  it('partitions client notifications by tenant and session generation', () => {
    const first = navigationScopeForSession({ id: 'a', role: 'SHOP_ADMIN', shopId: 'shop-a', sessionVersion: 1 })
    const secondShop = navigationScopeForSession({ id: 'b', role: 'SHOP_ADMIN', shopId: 'shop-b', sessionVersion: 1 })
    const revokedSession = navigationScopeForSession({ id: 'a', role: 'SHOP_ADMIN', shopId: 'shop-a', sessionVersion: 2 })
    expect(new Set([first, secondShop, revokedSession]).size).toBe(3)
  })

  it('partitions client notifications by live owner/staff authorization generation', () => {
    const owner = navigationScopeForSession({
      id: 'a', role: 'SHOP_ADMIN', shopId: 'shop-a', sessionVersion: 1,
      memberKind: 'SHOP_OWNER', authorizationVersion: 1, permissionVersion: 1,
    })
    const staff = navigationScopeForSession({
      id: 'a', role: 'SHOP_ADMIN', shopId: 'shop-a', sessionVersion: 1,
      memberKind: 'SHOP_STAFF', authorizationVersion: 1, permissionVersion: 1,
    })
    const packageChanged = navigationScopeForSession({
      id: 'a', role: 'SHOP_ADMIN', shopId: 'shop-a', sessionVersion: 1,
      memberKind: 'SHOP_OWNER', authorizationVersion: 2, permissionVersion: 1,
    })
    expect(new Set([owner, staff, packageChanged]).size).toBe(3)
  })

  it('targets the real worker-management path and authorization domain after staff changes', () => {
    const impact = navigationImpactForMutation({ kind: 'shop.staffUpdated' })
    expect(impact.domains).toContain('access')
    expect(impact.paths).toContain('/shop/xodimlar')
    expect(impact.paths).not.toContain('/shop/staff')
  })
})
