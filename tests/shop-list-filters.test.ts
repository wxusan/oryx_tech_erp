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
})
