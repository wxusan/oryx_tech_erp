import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { buildShopDevicesWhere, buildShopNasiyalarWhere } from '@/lib/server/shop-lists'

describe('canonical shop list filters', () => {
  it('device search includes active primary/secondary IMEI rows and normalized scans', () => {
    const where = buildShopDevicesWhere('shop-1', { search: '35 912-3456789012' })
    const serialized = JSON.stringify(where)

    expect(serialized).toContain('"imeis":{"some":{"deletedAt":null')
    expect(serialized).toContain('"value":{"contains":"35 912-3456789012"')
    expect(serialized).toContain('"normalizedValue":{"contains":"359123456789012"}')
  })

  it('nasiya search reaches the device secondary IMEI relation, not only Device.imei', () => {
    const where = buildShopNasiyalarWhere('shop-1', { search: '86 001-2345678901' })
    const serialized = JSON.stringify(where)

    expect(serialized).toContain('"device":{"imei":{"contains":"86 001-2345678901"')
    expect(serialized).toContain('"device":{"imeis":{"some":{"deletedAt":null')
    expect(serialized).toContain('"normalizedValue":{"contains":"860012345678901"}')
  })

  it('does not create an always-true normalized IMEI condition for separator-only searches', () => {
    const where = buildShopNasiyalarWhere('shop-1', { search: '---' })
    expect(JSON.stringify(where)).not.toContain('"normalizedValue":{"contains":""}')
  })

  it('uses one contiguous 2446 needle across text, primary/secondary IMEI, and phone documents', () => {
    const device = JSON.stringify(buildShopDevicesWhere('shop-1', { search: '2446' }))
    const nasiya = JSON.stringify(buildShopNasiyalarWhere('shop-1', { search: '2446' }))

    for (const serialized of [device, nasiya]) {
      expect(serialized).toContain('"contains":"2446"')
      expect(serialized).toContain('"normalizedValue":{"contains":"2446"}')
      expect(serialized).toContain('"phoneSearchDigits":{"contains":"2446"}')
      expect(serialized).not.toContain('"additionalPhones":{"has":"2446"}')
    }
    expect(device).toContain('"model":{"contains":"2446"')
    expect(device).toContain('"note":{"contains":"2446"')
    expect(nasiya).toContain('"device":{"model":{"contains":"2446"')
    expect(nasiya).toContain('"note":{"contains":"2446"')
  })

  it('does not add identifier predicates for mixed model text such as iPhone 13', () => {
    const device = JSON.stringify(buildShopDevicesWhere('shop-1', { search: 'iPhone 13' }))
    const nasiya = JSON.stringify(buildShopNasiyalarWhere('shop-1', { search: 'iPhone 13' }))

    expect(device).toContain('"model":{"contains":"iPhone 13"')
    expect(nasiya).toContain('"model":{"contains":"iPhone 13"')
    for (const serialized of [device, nasiya]) {
      expect(serialized).not.toContain('"phoneSearchDigits"')
      expect(serialized).not.toContain('"normalizedValue"')
    }
  })

  it('retains tenant and soft-delete scope with bounded pagination-independent filters', () => {
    for (const where of [
      buildShopDevicesWhere('shop-1', { search: '2446' }),
      buildShopNasiyalarWhere('shop-1', { search: '2446' }),
    ]) {
      expect(where).toMatchObject({ shopId: 'shop-1', deletedAt: null })
    }
  })
})
