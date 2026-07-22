import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

function prismaModel(source: string, model: string): string {
  const start = source.indexOf(`model ${model} {`)
  if (start < 0) throw new Error(`Prisma model ${model} not found`)
  const nextModel = source.indexOf('\nmodel ', start + 1)
  return source.slice(start, nextModel < 0 ? source.length : nextModel)
}

/**
 * Item 12 — nasiya client trust/rating system. The pure computation
 * (computeCustomerTrustRating) is unit-tested directly in
 * tests/nasiya-customer-trust.test.ts. These guard tests confirm it's
 * actually wired into the API routes and UI surfaces the ticket named:
 * customer profile (edit dialog), nasiya creation, nasiya profile, and the
 * customer list badge.
 */
describe('schema: optional admin override, never read by accounting logic', () => {
  it('Customer.trustOverride is additive (nullable string, no default enforced)', () => {
    const schema = read('prisma/schema.prisma')
    const block = prismaModel(schema, 'Customer')
    expect(block).toMatch(/trustOverride\s+String\?/)
  })

  it('never referenced by any payment/allocation/schedule logic', () => {
    expect(read('src/lib/nasiya-payment-allocation.ts')).not.toContain('trustOverride')
    expect(read('src/app/api/nasiya/[id]/payment/route.ts')).not.toContain('trustOverride')
  })
})

describe('customer list query includes a trust badge per customer', () => {
  const source = read('src/lib/server/customer-list.ts')

  it('computes the badge from a bounded one-row-per-customer aggregate and applies any override', () => {
    expect(source).toContain('getCustomerTrustFactorsForList')
    expect(source).toContain('computeCustomerTrustRatingFromFactors(')
    expect(source).toContain('isValidTrustTier(trustOverride)')
    expect(source).not.toContain('schedules: {')
  })

  it('the list payload only carries tier/label/color (reasons fetched on demand for the full profile)', () => {
    expect(source).toContain('trust: { tier: trust.tier, label: trust.label, color: trust.color }')
  })
})

describe('GET /api/customers/[id] returns the full explainable rating', () => {
  const source = read('src/app/api/customers/[id]/route.ts')

  it('has a GET handler (customer profile data source)', () => {
    expect(source).toContain('export async function GET(')
  })

  it('is shop-scoped like every other customer route', () => {
    const getStart = source.indexOf('export async function GET(')
    const getBlock = source.slice(getStart, getStart + 900)
    expect(getBlock).toContain('shopId: resolved.shopId')
  })

  it('PATCH accepts an optional trustOverride and validates it against the 5 known tiers', () => {
    expect(source).toContain("trustOverride: z.enum(['NEW', 'LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH']).nullable().optional()")
  })
})

describe('GET /api/customers/by-phone — existing-customer lookup for the nasiya creation form', () => {
  const source = read('src/app/api/customers/by-phone/route.ts')

  it('returns found:false rather than a 404 for a brand-new phone', () => {
    expect(source).toContain("ok({ found: false }")
  })

  it('is shop-scoped', () => {
    expect(source).toContain('shopId: resolved.shopId')
  })
})

describe('GET /api/nasiya/[id] includes customerTrust aggregated across ALL of the customer\'s nasiyas', () => {
  const source = read('src/app/api/nasiya/[id]/route.ts')

  it('queries every nasiya for this customer in this shop, not just the current one', () => {
    expect(source).toContain('getCustomerTrustFactorsForList({ shopId: nasiya.shopId, customerIds: [nasiya.customer.id] })')
    const trustQuery = read('src/lib/server/customer-trust-queries.ts')
    expect(trustQuery).toContain('WHERE c."shopId" = ${input.shopId}')
    expect(trustQuery).toContain('ON n."customerId" = c."id"')
    expect(trustQuery).toContain('AND n."shopId" = c."shopId"')
    expect(trustQuery).toContain('c."id" IN (${Prisma.join(input.customerIds)})')
  })

  it('includes customerTrust only for principals allowed to view customer trust context', () => {
    expect(source).toContain('const includeCustomerTrust =')
    expect(source).toContain("principalHasPermission(guarded.principal, 'NASIYA_VIEW')")
    expect(source).toContain('...(customerTrust ? { customerTrust } : {})')
  })
})

describe('nasiya detail page shows the customer trust badge and its reasons', () => {
  const source = read('src/app/(shop)/shop/nasiyalar/[id]/page.tsx')

  it('renders TrustBadge next to the customer name', () => {
    expect(source).toContain('{nasiya.customerTrust && <TrustBadge trust={nasiya.customerTrust} />}')
  })
})

describe('nasiya creation form: explicit existing-customer trust preview', () => {
  const source = read('src/app/(shop)/shop/nasiyalar/new/page.tsx')
  const combobox = read('src/components/shop/customer-combobox.tsx')
  const picker = read('src/app/api/customers/picker/route.ts')

  it('uses the shared combobox instead of silently matching a typed phone', () => {
    expect(source).toContain('<CustomerCombobox')
    expect(source).toContain("customerMode: customerMode === 'EXISTING' ? 'EXISTING' : 'NEW'")
    expect(source).toContain('customerId: selectedCustomer?.id')
    expect(source).not.toContain('/api/customers/by-phone?phone=')
  })

  it('debounces tenant-scoped picker search and renders its trust summary', () => {
    expect(combobox).toContain("'/api/customers/picker'")
    expect(combobox).toContain('customerSearchRequest({ search: debouncedSearch }, signal)')
    expect(read('src/lib/customer-search-transport.ts')).toContain("method: 'POST'")
    expect(combobox).toContain('setDebouncedSearch(search.trim())')
    expect(combobox).toContain('selected.trust?.label')
    expect(combobox).toContain('customer.trust?.label')
    expect(picker).toContain('resolveActiveShopId(guarded.session')
    expect(picker).toContain('customerSearchWhere(resolved.shopId, parsed.data.search)')
    expect(picker).toContain('trust: { tier: trust.tier, label: trust.label, color: trust.color }')
  })

  it('lets permitted staff edit the selected customer without leaving the Nasiya flow', () => {
    expect(source).toContain("const canEditCustomer = can('CUSTOMER_EDIT')")
    expect(source).toContain('onEdit={canEditCustomer || canManageCustomerPassport || canOverrideCustomerTrust ? openCustomerEdit : undefined}')
    expect(source).toContain("method: 'PATCH'")
    expect(source).toContain("kind: 'customer.updated'")
  })

  it('shows the existing customer passport state without asking for a duplicate upload', () => {
    expect(source).toContain('Pasport rasmi kiritilmagan')
    expect(source).toContain('Pasport rasmini almashtirish (ixtiyoriy)')
    expect(source).toContain("Yangi rasm tanlanmasa, mavjud private rasm saqlanib qoladi")
  })
})

describe('mijozlar list: badge column + admin override in the edit dialog', () => {
  const source = read('src/app/(shop)/shop/mijozlar/customers-client.tsx')

  it('renders a trust badge column in the table', () => {
    expect(source).toContain('<td className="px-4 py-3">{customer.trust && <TrustBadge trust={customer.trust} />}</td>')
  })

  it('the edit dialog lets an admin override the tier, defaulting to "Avtomatik hisoblash"', () => {
    expect(source).toContain('<TrustSelectItem value="AUTO">Avtomatik hisoblash</TrustSelectItem>')
  })

  it('sends trustOverride on save', () => {
    expect(source).toContain('trustOverride: trustOverride || null')
  })
})

describe('TrustBadge component uses the exact Uzbek tier labels, never "credit score" wording', () => {
  const source = read('src/components/shop/trust-badge.tsx')

  it('does not hardcode English/credit-score terminology', () => {
    expect(source.toLowerCase()).not.toContain('credit score')
    expect(source.toLowerCase()).not.toContain('kredit reyting')
  })
})
