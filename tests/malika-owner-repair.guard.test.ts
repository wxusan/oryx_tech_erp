import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

describe('shop ownership authority and guarded Malika repair', () => {
  it('allows a super-admin to create only the first owner, never a later staff member', () => {
    const route = source('src/app/api/shops/[id]/admins/route.ts')

    expect(route).toContain('const createOwnerSchema')
    expect(route).toContain("shop.ownerAdminId || shop.ownershipStatus === 'RESOLVED'")
    expect(route).toContain("ownershipStatus: 'RESOLVED'")
    expect(route).toContain("action: 'OWNER_CREATE'")
    expect(route).not.toContain('getActiveShopPackage')
    expect(route).not.toContain('STAFF_ACCESS_DISABLED')
  })

  it('keeps staff creation behind its exact live capability', () => {
    const route = source('src/app/api/shop/staff/route.ts')
    expect(route).toContain("requireCurrentShopPermission('STAFF_CREATE')")
    expect(route).not.toContain("requireCurrentShopPermission('MEMBER_MANAGE')")
  })

  it('makes the production owner repair inert unless a guarded release explicitly enables it', () => {
    const repair = source('scripts/repair-malika-owner.mjs')
    const workflow = source('.github/workflows/release-production.yml')

    expect(repair).toContain("process.env.ORYX_MALIKA_OWNER_REPAIR === '1'")
    expect(repair).toContain("process.env.VERCEL_ENV !== 'production'")
    expect(repair).toContain("process.env.ORYX_GUARDED_RELEASE !== 'github-actions'")
    expect(repair).toContain("OWNER_LOGIN = 'malika_owner'")
    expect(repair).toContain("ownershipStatus\" = 'RESOLVED'")
    expect(workflow).toContain('repair_malika_owner')
    expect(workflow).toContain('ORYX_MALIKA_OWNER_REPAIR_PASSWORD')
  })
})
