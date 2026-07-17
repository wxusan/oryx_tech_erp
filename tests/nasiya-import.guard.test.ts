import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

// Source-level guards for the "import old nasiya" feature. Behavioral DB
// coverage also runs in tests/integration/business-routes.integration.test.ts.

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}
function readFlat(rel: string): string {
  return read(rel).replace(/\s+/g, ' ')
}

describe('accounting isolation: stats exclude imported nasiyas', () => {
  const src = readFlat('src/lib/server/shop-stats.ts')
  const queries = readFlat('src/lib/server/shop-stats-queries.ts')

  it('the payment-basis aggregate excludes unknown imported margin and interest', () => {
    expect(src).toContain('getShopMonthlyAccountingAggregate({ shopId, monthStart, monthEnd, adminId })')
    expect(queries).toContain('n."accountingReconstructionStatus" IN (\'COMPLETE\', \'PARTIAL\')')
    expect(queries).toContain('sum(a."marginAmountUzs")')
    expect(queries).toContain('sum(a."interestAmountUzs")')
  })

  it('imported devices are excluded from the device count', () => {
    expect(src).toContain('deletedAt: null, isImported: false')
  })
})

describe('import route safety', () => {
  const src = readFlat('src/app/api/nasiya/import/route.ts')

  it('is SHOP_ADMIN-only and uses the session shopId (tenant isolation)', () => {
    expect(src).toContain("session.user.role !== 'SHOP_ADMIN'")
    expect(src).toContain('const shopId = session.user.shopId')
    // Never trusts a client-supplied shopId.
    expect(src).not.toContain('resolveActiveShopId')
  })

  it('creates the device as SOLD_NASIYA (not sellable) and imported, cost 0', () => {
    expect(src).toContain("status: 'SOLD_NASIYA'")
    expect(src).toContain('isImported: true')
    expect(src).toContain('purchasePrice: 0')
    expect(src).not.toContain("status: 'IN_STOCK'")
  })

  it('creates the nasiya as imported via MANUAL source with import bookkeeping', () => {
    expect(src).toContain("importSource: 'MANUAL'")
    expect(src).toContain('importedById: session.user.id')
    expect(src).toContain('remainingAtImport')
    expect(src).toContain("accountingReconstructionStatus: 'UNRECONSTRUCTABLE'")
  })

  it('does NOT create a Sale row or a NasiyaPayment for already-paid money', () => {
    expect(src).not.toContain('tx.sale.create')
    expect(src).not.toContain('nasiyaPayment.create')
  })

  it('rejects a duplicate active IMEI and backstops on P2002', () => {
    expect(src).toContain("{ imeis: { some: { normalizedValue: { in: imeiValues }, deletedAt: null } } }")
    expect(src).toContain("err.code === 'P2002'")
  })

  it('finds/creates the customer by normalized phone, shop-scoped, and audit-logs', () => {
    expect(src).toContain('normalizePhone(data.customerPhone)')
    expect(src).toContain('tx.customer.findFirst')
    expect(src).toContain("action: 'IMPORT_NASIYA'")
    expect(src).toContain('invalidateShopNasiyaMutation(shopId)')
  })

  it('sends the imported-nasiya Telegram template (not the new-nasiya one)', () => {
    expect(src).toContain('nasiyaImportedMessage(')
    expect(src).not.toContain('nasiyaCreatedMessage(')
  })
})

describe('import UI + docs wiring', () => {
  it('the manual import page exists', () => {
    expect(existsSync(resolve(process.cwd(), 'src/app/(shop)/shop/nasiyalar/import/page.tsx'))).toBe(true)
  })

  it('the nasiyalar list links to the import page and shows an "Avvalgi nasiya" badge', () => {
    const src = read('src/app/(shop)/shop/nasiyalar/nasiyalar-client.tsx')
    expect(src).toContain('/shop/nasiyalar/import')
    expect(src).toContain('Avvalgi nasiya')
    expect(src).toContain('n.isImported')
  })

  it('the nasiya detail page renders an import card', () => {
    const src = read('src/app/(shop)/shop/nasiyalar/[id]/page.tsx')
    expect(src).toContain('nasiya.importData?.isImported')
    expect(src).toContain("Importgacha to'langan")
  })

  it('the nasiya export includes imported columns', () => {
    const src = read('src/app/api/export/[entity]/route.ts')
    for (const col of ['isImported', 'importSource', 'originalTotalAmount', 'alreadyPaidBeforeImport', 'remainingAtImport']) {
      expect(src).toContain(`'${col}'`)
    }
  })

  it('the docs page exists', () => {
    expect(existsSync(resolve(process.cwd(), 'docs/import-old-nasiya.md'))).toBe(true)
  })
})

describe('schema import fields', () => {
  const schema = read('prisma/schema.prisma')
  it('Nasiya has the import fields', () => {
    for (const f of ['isImported', 'importSource', 'importedAt', 'originalTotalAmount', 'alreadyPaidBeforeImport', 'remainingAtImport']) {
      expect(schema).toContain(f)
    }
  })
  it('a migration adds the columns', () => {
    const sql = read('prisma/migrations/202607030005_import_old_nasiya/migration.sql')
    expect(sql).toContain('ADD COLUMN "alreadyPaidBeforeImport"')
    expect(sql).toContain('ADD COLUMN "isImported"')
  })
})
