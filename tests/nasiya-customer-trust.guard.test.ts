import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
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
    const block = schema.slice(schema.indexOf('model Customer'), schema.indexOf('model Customer') + 1400)
    expect(block).toMatch(/trustOverride\s+String\?/)
  })

  it('never referenced by any payment/allocation/schedule logic', () => {
    expect(read('src/lib/nasiya-payment-allocation.ts')).not.toContain('trustOverride')
    expect(read('src/app/api/nasiya/[id]/payment/route.ts')).not.toContain('trustOverride')
  })
})

describe('GET /api/customers (list) includes a trust badge per customer', () => {
  const source = read('src/app/api/customers/route.ts')

  it('computes the rating from each customer\'s nested nasiya/schedules and applies any override', () => {
    expect(source).toContain('computeCustomerTrustRating(nasiyaInputs, new Date(), override)')
    expect(source).toContain('isValidTrustTier(trustOverride)')
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
    const block = source.slice(source.indexOf('customerNasiyas'), source.indexOf('customerNasiyas') + 400)
    expect(block).toContain('customerId: nasiya.customer.id')
    expect(block).toContain('shopId: nasiya.shopId')
  })

  it('includes customerTrust in the response', () => {
    expect(source).toContain('customerTrust,')
  })
})

describe('nasiya detail page shows the customer trust badge and its reasons', () => {
  const source = read('src/app/(shop)/shop/nasiyalar/[id]/page.tsx')

  it('renders TrustBadge next to the customer name', () => {
    expect(source).toContain('{nasiya.customerTrust && <TrustBadge trust={nasiya.customerTrust} />}')
  })
})

describe('nasiya creation form: existing-customer trust preview', () => {
  const source = read('src/app/(shop)/shop/nasiyalar/new/page.tsx')

  it('debounces a by-phone lookup as the phone is typed', () => {
    expect(source).toContain('/api/customers/by-phone?phone=')
  })

  it('shows the badge only when an existing customer was found', () => {
    expect(source).toContain('{existingCustomerTrust && (')
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
