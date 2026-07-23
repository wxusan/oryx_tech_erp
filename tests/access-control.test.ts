import { describe, expect, it } from 'vitest'
import {
  ACTIVE_SHOP_PERMISSION_CODES,
  SHOP_FEATURE_CODES,
  SHOP_PERMISSION_CATALOG,
  calculateRecurringPackagePrice,
  permissionRequiredFeatures,
  principalCan,
  shopMemberKind,
  type PackageFeatureInput,
  type ShopPrincipalAccess,
} from '@/lib/access-control'

function features(overrides: Partial<Record<(typeof SHOP_FEATURE_CODES)[number], Partial<PackageFeatureInput>>> = {}) {
  return SHOP_FEATURE_CODES.map((featureCode) => ({
    featureCode,
    enabled: true,
    recurringPrice: featureCode === 'STAFF_ACCESS' ? 0 : 10,
    ...overrides[featureCode],
  }))
}

describe('shop package price', () => {
  it('never includes STAFF_ACCESS in the recurring price', () => {
    const enabled = calculateRecurringPackagePrice({
      basePrice: 100,
      discountAmount: 20,
      currency: 'USD',
      features: features(),
    })
    const disabled = calculateRecurringPackagePrice({
      basePrice: 100,
      discountAmount: 20,
      currency: 'USD',
      features: features({ STAFF_ACCESS: { enabled: false } }),
    })

    expect(enabled).toEqual(disabled)
    expect(enabled.staffAccessPrice).toBe(0)
  })

  it('rejects any attempt to attach a price to STAFF_ACCESS', () => {
    expect(() => calculateRecurringPackagePrice({
      basePrice: 100,
      discountAmount: 0,
      currency: 'UZS',
      features: features({ STAFF_ACCESS: { recurringPrice: 1 } }),
    })).toThrow("paket narxiga kiritilmaydi")
  })

  it('requires a complete snapshot and explicit feature prerequisites', () => {
    expect(() => calculateRecurringPackagePrice({
      basePrice: 100,
      discountAmount: 0,
      currency: 'UZS',
      features: features().slice(1),
    })).toThrow("har bir modul")

    expect(() => calculateRecurringPackagePrice({
      basePrice: 100,
      discountAmount: 0,
      currency: 'UZS',
      features: features({ INVENTORY: { enabled: false } }),
    })).toThrow('Ombor boshqaruvi')
  })

  it('uses exact native-currency minor units and never permits an excessive discount', () => {
    expect(calculateRecurringPackagePrice({
      basePrice: 100.25,
      discountAmount: 0.25,
      currency: 'USD',
      features: features(Object.fromEntries(
        SHOP_FEATURE_CODES.filter((code) => code !== 'STAFF_ACCESS').map((code) => [code, { recurringPrice: 0 }]),
      )),
    }).recurringPrice).toBe(100)

    expect(() => calculateRecurringPackagePrice({
      basePrice: 100,
      discountAmount: 101,
      currency: 'UZS',
      features: features(Object.fromEntries(
        SHOP_FEATURE_CODES.filter((code) => code !== 'STAFF_ACCESS').map((code) => [code, { recurringPrice: 0 }]),
      )),
    })).toThrow('oshmasligi kerak')
  })
})

describe('owner and staff authorization', () => {
  const enabledFeatures = new Set(SHOP_FEATURE_CODES)
  const principal = (overrides: Partial<ShopPrincipalAccess>): ShopPrincipalAccess => ({
    memberKind: 'SHOP_STAFF',
    legacyFullAccess: false,
    enabledFeatures,
    grantedPermissions: new Set(),
    ...overrides,
  })

  it('derives one authoritative member kind from the shop owner identity', () => {
    expect(shopMemberKind({ memberId: 'owner', ownerAdminId: 'owner' })).toBe('SHOP_OWNER')
    expect(shopMemberKind({ memberId: 'staff', ownerAdminId: 'owner' })).toBe('SHOP_STAFF')
  })

  it('gives owners package-bounded permissions and keeps retired aliases out of live staff authorization', () => {
    expect(principalCan(principal({ memberKind: 'SHOP_OWNER' }), 'MEMBER_MANAGE')).toBe(true)
    expect(principalCan(principal({ grantedPermissions: new Set(['MEMBER_MANAGE']) }), 'MEMBER_MANAGE')).toBe(false)
    expect(principalCan(principal({ grantedPermissions: new Set(['CASH_SALE_CREATE']) }), 'CASH_SALE_CREATE')).toBe(false)
    expect(principalCan(principal({ grantedPermissions: new Set(['SALE_CREATE']) }), 'SALE_CREATE')).toBe(true)
  })

  it('never grants a permission when its feature is disabled', () => {
    expect(principalCan(principal({
      memberKind: 'SHOP_OWNER',
      enabledFeatures: new Set(SHOP_FEATURE_CODES.filter((code) => code !== 'REPORTS')),
    }), 'REPORT_VIEW')).toBe(false)
  })

  it('preserves legacy operational access without expanding it to new owner-only powers', () => {
    expect(principalCan(principal({ legacyFullAccess: true }), 'SALE_CREATE')).toBe(true)
    expect(principalCan(principal({ legacyFullAccess: true }), 'LOG_VIEW')).toBe(true)
    expect(principalCan(principal({ legacyFullAccess: true }), 'REPORT_VIEW')).toBe(false)
    expect(principalCan(principal({ legacyFullAccess: true }), 'EXPORT_SALES')).toBe(false)
    expect(principalCan(principal({ legacyFullAccess: true }), 'STAFF_VIEW')).toBe(false)
  })

  it('enforces the complete typed permission matrix for staff', () => {
    expect(ACTIVE_SHOP_PERMISSION_CODES).toHaveLength(60)
    expect(new Set(ACTIVE_SHOP_PERMISSION_CODES).size).toBe(60)
    for (const permission of SHOP_PERMISSION_CATALOG) {
      const granted = principal({ grantedPermissions: new Set([permission.code]) })
      expect(principalCan(granted, permission.code), permission.code).toBe(!permission.ownerOnly && !permission.retired)

      for (const requiredFeature of permissionRequiredFeatures(permission.code)) {
        const withoutFeature = principal({
          grantedPermissions: new Set([permission.code]),
          enabledFeatures: new Set(SHOP_FEATURE_CODES.filter((code) => code !== requiredFeature)),
        })
        expect(principalCan(withoutFeature, permission.code), `${permission.code} ${requiredFeature} feature gate`).toBe(false)
      }
    }
  })
})
