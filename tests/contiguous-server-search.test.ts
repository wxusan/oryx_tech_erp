import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/api-auth', () => ({}))

import { customerSearchWhere } from '@/lib/server/customer-search'
import { buildOlibSotdimWhere } from '@/app/api/olib-sotdim/route'
import {
  buildIncomingDebtSearchWhere,
  buildOutgoingDebtSearchWhere,
} from '@/lib/server/debts'
import { scopeCustomerList } from '@/lib/server/customer-list'
import { buildSalesWhere } from '@/lib/server/sales-list'

describe('customer and sales contiguous server predicates', () => {
  it('uses one partial phone document for primary and additional phone matches', () => {
    const customer = JSON.stringify(customerSearchWhere('shop-1', '2446', { includeNote: true }))
    const sales = JSON.stringify(buildSalesWhere('shop-1', '2446'))

    for (const serialized of [customer, sales]) {
      expect(serialized).toContain('"phoneSearchDigits":{"contains":"2446"}')
      expect(serialized).not.toContain('"additionalPhones":{"has":"2446"}')
      expect(serialized).toContain('"shopId":"shop-1"')
      expect(serialized).toContain('"deletedAt":null')
    }
  })

  it('searches primary/secondary IMEI in sales without joining fragments across fields', () => {
    const sales = JSON.stringify(buildSalesWhere('shop-1', '2446'))
    expect(sales).toContain('"imei":{"contains":"2446"')
    expect(sales).toContain('"normalizedValue":{"contains":"2446"}')
    expect(sales).toContain('"imeis":{"some":{"deletedAt":null')
  })

  it('does not add phone or normalized IMEI fallbacks for iPhone 13', () => {
    const customer = JSON.stringify(customerSearchWhere('shop-1', 'iPhone 13'))
    const sales = JSON.stringify(buildSalesWhere('shop-1', 'iPhone 13'))

    expect(customer).not.toContain('"phoneSearchDigits"')
    expect(sales).not.toContain('"phoneSearchDigits"')
    expect(sales).not.toContain('"normalizedValue"')
    expect(sales).toContain('"model":{"contains":"iPhone 13"')
  })

  it.each([
    ['%', '\\%'],
    ['_', '\\_'],
    ['\\', '\\\\'],
  ])('escapes literal %s before constructing Prisma contains predicates', (query, escaped) => {
    const customer = JSON.stringify(customerSearchWhere('shop-1', query))
    const sales = JSON.stringify(buildSalesWhere('shop-1', query))
    expect(customer).toContain(JSON.stringify(escaped).slice(1, -1))
    expect(sales).toContain(JSON.stringify(escaped).slice(1, -1))
  })
})

describe('olib-sotdim and debt contiguous server predicates', () => {
  it('covers note, secondary IMEI, and partial customer phones in olib-sotdim', () => {
    const serialized = JSON.stringify(buildOlibSotdimWhere('shop-1', { search: '2446' }))

    expect(serialized).toContain('"shopId":"shop-1"')
    expect(serialized).toContain('"origin":"OLIB_SOTDIM"')
    expect(serialized).toContain('"deletedAt":null')
    expect(serialized).toContain('"supplierNote":{"contains":"2446"')
    expect(serialized).toContain('"normalizedValue":{"contains":"2446"}')
    expect(serialized).toContain('"phoneSearchDigits":{"contains":"2446"}')
  })

  it('covers secondary IMEI in both debt directions and additional phones only where applicable', () => {
    const outgoing = JSON.stringify(buildOutgoingDebtSearchWhere('2446'))
    const incoming = JSON.stringify(buildIncomingDebtSearchWhere('2446'))

    for (const serialized of [outgoing, incoming]) {
      expect(serialized).toContain('"normalizedValue":{"contains":"2446"}')
      expect(serialized).toContain('"imeis":{"some":{"deletedAt":null')
    }
    expect(outgoing).not.toContain('"phoneSearchDigits"')
    expect(incoming).toContain('"phoneSearchDigits":{"contains":"2446"}')
  })

  it('does not add numeric identifier fallbacks for iPhone 13', () => {
    const olib = JSON.stringify(buildOlibSotdimWhere('shop-1', { search: 'iPhone 13' }))
    const outgoing = JSON.stringify(buildOutgoingDebtSearchWhere('iPhone 13'))
    const incoming = JSON.stringify(buildIncomingDebtSearchWhere('iPhone 13'))

    for (const serialized of [olib, outgoing, incoming]) {
      expect(serialized).not.toContain('"normalizedValue"')
      expect(serialized).not.toContain('"phoneSearchDigits"')
      expect(serialized).toContain('"model":{"contains":"iPhone 13"')
    }
  })

  it.each([
    ['%', '\\%'],
    ['_', '\\_'],
    ['\\', '\\\\'],
  ])('keeps literal wildcard-looking query %s escaped', (query, escaped) => {
    for (const where of [
      buildOlibSotdimWhere('shop-1', { search: query }),
      buildOutgoingDebtSearchWhere(query),
      buildIncomingDebtSearchWhere(query),
    ]) {
      expect(JSON.stringify(where)).toContain(JSON.stringify(escaped).slice(1, -1))
    }
  })
})

describe('customer search evidence permissions', () => {
  const baseData = {
    total: 1,
    skip: 0,
    take: 25,
    items: [{
      id: 'customer-1',
      shopId: 'shop-1',
      name: 'Passport customer',
      phone: '+998901111111',
      phoneNormalizationNeedsReview: false,
      additionalPhones: ['+998950024467'],
      note: 'Hidden note',
      createdAt: '2026-07-23T00:00:00.000Z',
      passportMasked: '••••4567',
      hasPassportPhoto: false,
      trust: { tier: 'NEW', label: 'Yangi', color: 'zinc' },
      _count: { sales: 0, nasiya: 0 },
      matchEvidence: [{ field: 'PASSPORT' as const }],
    }],
  }

  it('removes passport evidence without passport permission', () => {
    const scoped = scopeCustomerList(baseData as Parameters<typeof scopeCustomerList>[0], {
      canViewCustomers: true,
      canEditCustomer: true,
      canUsePassport: false,
      canOverrideTrust: true,
    })
    expect(scoped.items[0]).not.toHaveProperty('matchEvidence')
  })

  it('keeps only the neutral field marker when passport permission is present', () => {
    const scoped = scopeCustomerList(baseData as Parameters<typeof scopeCustomerList>[0], {
      canViewCustomers: true,
      canEditCustomer: true,
      canUsePassport: true,
      canOverrideTrust: true,
    })
    expect(scoped.items[0].matchEvidence).toEqual([{ field: 'PASSPORT' }])
    expect(JSON.stringify(scoped.items[0].matchEvidence)).not.toContain('AA1234567')
  })
})
