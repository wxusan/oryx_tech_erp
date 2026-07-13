import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  FORM_SURFACE_CONTRACT,
  MUTATION_FORM_SOURCE_INVENTORY,
  SEARCH_SURFACE_CONTRACT,
} from '@/lib/field-search-contract'

function walkTsx(directory: string): string[] {
  return readdirSync(resolve(process.cwd(), directory), { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? walkTsx(path) : entry.name.endsWith('.tsx') ? [path] : []
  })
}

describe('ERP 2.0 field/search contract', () => {
  it('has unique operation, field, and search identifiers with real evidence files', () => {
    const operationIds = FORM_SURFACE_CONTRACT.map(({ id }) => id)
    const fieldIds = FORM_SURFACE_CONTRACT.flatMap(({ fields }) => fields.map(({ id }) => id))
    const searchIds = SEARCH_SURFACE_CONTRACT.map(({ id }) => id)

    expect(new Set(operationIds).size).toBe(operationIds.length)
    expect(new Set(fieldIds).size).toBe(fieldIds.length)
    expect(new Set(searchIds).size).toBe(searchIds.length)

    for (const surface of FORM_SURFACE_CONTRACT) {
      expect(existsSync(resolve(process.cwd(), surface.source)), surface.source).toBe(true)
      const schemaFile = surface.schemaSource.split('#')[0]
      expect(existsSync(resolve(process.cwd(), schemaFile)), surface.schemaSource).toBe(true)
      expect(surface.fields.length, surface.id).toBeGreaterThan(0)
    }
    for (const surface of SEARCH_SURFACE_CONTRACT) {
      expect(existsSync(resolve(process.cwd(), surface.source)), surface.source).toBe(true)
      expect(surface.parameters.length, surface.id).toBeGreaterThan(0)
      expect(surface.searchableFields.length, surface.id).toBeGreaterThan(0)
    }
  })

  it('requires every conditional rule to be explicit and every reusable identifier to have a search decision', () => {
    const searchIds = new Set<string>(SEARCH_SURFACE_CONTRACT.map(({ id }) => id))

    for (const surface of FORM_SURFACE_CONTRACT) {
      for (const field of surface.fields) {
        if (field.requirement === 'CONDITIONAL') {
          expect(field.requiredWhen, field.id).toBeTruthy()
        } else {
          expect(field.requiredWhen, field.id).toBeUndefined()
        }

        if (field.classification === 'BUSINESS_IDENTIFIER' || field.classification === 'PRIVATE_DOCUMENT') {
          expect(
            Boolean(field.searchSurfaceIds?.length) || Boolean(field.noSearchReason),
            `${field.id} needs a tenant search surface or an explicit no-search decision`,
          ).toBe(true)
        }
        if (field.classification === 'SECRET') {
          expect(field.searchSurfaceIds, `${field.id} must never be searchable`).toBeUndefined()
          expect(field.noSearchReason, field.id).toBeTruthy()
        }
        for (const searchId of field.searchSurfaceIds ?? []) {
          expect(searchIds.has(searchId), `${field.id} -> ${searchId}`).toBe(true)
        }
      }
    }
  })

  it('inventories every discovered user-authored mutation-control source', () => {
    const roots = [
      'src/app/(admin)',
      'src/app/(shop)',
      'src/components/admin',
      'src/components/shop',
      'src/components/auth',
    ]
    const hasControl = /<(?:Input|PhoneInput|MoneyInput|DateInput|StorageInput|Textarea|select|input|textarea)\b/
    const discovered = roots
      .flatMap(walkTsx)
      .filter((path) => {
        const source = readFileSync(resolve(process.cwd(), path), 'utf8')
        return /method\s*:/.test(source) && hasControl.test(source)
      })
      .sort()

    for (const source of discovered) {
      expect(MUTATION_FORM_SOURCE_INVENTORY, `${source} is missing from the maintained inventory`).toContain(source)
    }
    expect(MUTATION_FORM_SOURCE_INVENTORY).toContain('src/components/auth/role-login-form.tsx')
  })

  it('keeps secrets, private image keys, signed URLs, and free-text dates/amounts out of search', () => {
    const allSearchable = SEARCH_SURFACE_CONTRACT.flatMap(({ searchableFields }) => searchableFields).join(' ').toLowerCase()
    expect(allSearchable).not.toMatch(/password|private object key|signed url|passportphotourl/)

    const report = SEARCH_SURFACE_CONTRACT.find(({ id }) => id === 'shop-report-range')!
    expect(report.parameters).toEqual(expect.arrayContaining(['startMonth', 'endMonth']))
    const logs = SEARCH_SURFACE_CONTRACT.find(({ id }) => id === 'audit-log-list')!
    expect(logs.parameters).toEqual(expect.arrayContaining(['from', 'to']))

    for (const customerSurface of SEARCH_SURFACE_CONTRACT.filter(({ id }) => id === 'customer-list' || id === 'customer-picker')) {
      expect(customerSurface.transport).toBe('JSON_BODY')
      expect(customerSurface.endpoint).toMatch(/^POST \/api\/customers/)
    }
  })

  it('implements the required shop and device identifier searches in authoritative server predicates', () => {
    const shops = readFileSync(resolve(process.cwd(), 'src/app/api/shops/route.ts'), 'utf8')
    expect(shops).toContain('requireSuperAdmin()')
    for (const field of ['name', 'ownerName', 'ownerPhone', 'shopNumber']) {
      expect(shops, `admin shop search: ${field}`).toContain(`{ ${field}: { contains:`)
    }

    const devices = readFileSync(resolve(process.cwd(), 'src/lib/server/shop-lists.ts'), 'utf8')
    expect(devices).toContain('shopId,')
    expect(devices).toContain("{ supplier: { name: { contains: search")
    expect(devices).toContain("{ note: { contains: search")
    expect(devices).toContain('normalizedValue: { contains: searchImei }')
    expect(devices).toContain('conditionCode: query.condition')
  })

  it('uses the shared required-field contract and explicit custom-error focus on settings forms', () => {
    const admin = readFileSync(resolve(process.cwd(), 'src/app/(admin)/admin/settings/settings-client.tsx'), 'utf8')
    expect(admin).toContain('<Field label="Ism" required controlId="admin-name"')
    expect(admin).toContain('<Field label="1 USD uchun UZS" required controlId="manual-usd-rate"')
    expect(admin).toContain("document.getElementById('admin-confirm-password')?.focus()")

    const shop = readFileSync(resolve(process.cwd(), 'src/app/(shop)/shop/settings/page.tsx'), 'utf8')
    expect(shop).toContain('<Field label="Ism" required controlId="account-name"')
    expect(shop).toContain('<Field label="Telefon" required controlId="account-phone"')
    expect(shop).toContain('<Field label="Do\'kon nomi" required controlId="shop-name"')
    expect(shop).toContain("document.getElementById('shop-owner-phone')?.focus()")

    const password = readFileSync(resolve(process.cwd(), 'src/components/shop/settings-password-field.tsx'), 'utf8')
    expect(password).toContain('<Field label={label} required controlId={id}>')
  })

  it('maps role login and sale/nasiya edit commands to their concrete form payloads and schemas', () => {
    for (const operation of [
      'auth.superadmin.login',
      'auth.shop.login',
      'sale.update',
      'nasiya.update',
      'nasiya.reminder.update',
    ]) {
      expect(FORM_SURFACE_CONTRACT.some(({ id }) => id === operation), operation).toBe(true)
    }

    const login = readFileSync(resolve(process.cwd(), 'src/components/auth/role-login-form.tsx'), 'utf8')
    expect(login).toContain("signIn(isAdmin ? 'superadmin' : 'shopadmin'")
    expect(login).toContain("...(!isAdmin ? { rememberMe: form.rememberMe ? 'true' : 'false' } : {})")
    expect(login.match(/\brequired\b/g)?.length).toBeGreaterThanOrEqual(2)

    const auth = readFileSync(resolve(process.cwd(), 'src/lib/auth.ts'), 'utf8')
    expect(auth).toContain("id: 'superadmin'")
    expect(auth).toContain("id: 'shopadmin'")
    expect(auth).toContain("rememberMe: { label: 'Meni eslab qol', type: 'checkbox' }")
    expect(auth).toContain("typeof login !== 'string' || typeof password !== 'string'")

    const salePage = readFileSync(resolve(process.cwd(), 'src/app/(shop)/shop/qurilmalar/[id]/page.tsx'), 'utf8')
    expect(salePage).toContain('customerName: saleEditCustomerName.trim()')
    expect(salePage).toContain('dueDate: saleEditDueDate || null')
    expect(salePage).toContain('reminderEnabled: saleEditReminderEnabled')
    const saleRoute = readFileSync(resolve(process.cwd(), 'src/app/api/sales/[id]/route.ts'), 'utf8')
    expect(saleRoute).toContain('const updateSaleSchema = z.object({')
    expect(saleRoute).toContain("const forbiddenMoneyFields = ['salePrice', 'amountPaid', 'remainingAmount', 'paidFully']")

    const nasiyaPage = readFileSync(resolve(process.cwd(), 'src/app/(shop)/shop/nasiyalar/[id]/page.tsx'), 'utf8')
    expect(nasiyaPage).toContain('customerName: editCustomerName.trim()')
    expect(nasiyaPage).toContain('importNote: nasiya.isImported ? editImportNote.trim() : undefined')
    expect(nasiyaPage).toContain('body: JSON.stringify({ reminderEnabled: !nasiya.reminderEnabled })')
    const nasiyaRoute = readFileSync(resolve(process.cwd(), 'src/app/api/nasiya/[id]/route.ts'), 'utf8')
    expect(nasiyaRoute).toContain('const updateNasiyaSchema = z.object({')
    expect(nasiyaRoute).toContain('const forbiddenMoneyFields = [')
    const reminderRoute = readFileSync(resolve(process.cwd(), 'src/app/api/nasiya/[id]/reminder/route.ts'), 'utf8')
    expect(reminderRoute).toContain('const reminderSchema = z.object({')
    expect(reminderRoute).toContain('reminderEnabled: z.boolean()')
  })

  it('documents tenant-exact phone lookup and the legacy-summary/report-range filter split', () => {
    const byPhone = SEARCH_SURFACE_CONTRACT.find(({ id }) => id === 'customer-by-phone')!
    expect(byPhone.parameters).toEqual(['phone'])
    expect(byPhone.searchableFields).toEqual(['Customer.normalizedPhone (exact)'])
    const byPhoneRoute = readFileSync(resolve(process.cwd(), byPhone.source), 'utf8')
    expect(byPhoneRoute).toContain("requireShopPermission('CUSTOMER_VIEW')")
    expect(byPhoneRoute).toContain("resolveActiveShopId(session, searchParams.get('shopId'))")
    expect(byPhoneRoute).toContain('where: { shopId: resolved.shopId, deletedAt: null, normalizedPhone }')
    expect(byPhoneRoute).toContain('prisma.customer.findFirst({')

    const legacy = SEARCH_SURFACE_CONTRACT.find(({ id }) => id === 'legacy-shop-stats')!
    const range = SEARCH_SURFACE_CONTRACT.find(({ id }) => id === 'shop-report-range')!
    expect(legacy.parameters).toEqual(['month', 'admin'])
    expect(range.parameters).toEqual(['month', 'preset', 'startMonth', 'endMonth', 'admin'])

    const legacyRoute = readFileSync(resolve(process.cwd(), legacy.source), 'utf8')
    expect(legacyRoute).toContain("requireShopPermission('REPORT_VIEW')")
    expect(legacyRoute).toContain("resolveActiveShopId(session, searchParams.get('shopId'))")
    expect(legacyRoute).toContain("searchParams.get('month')")
    expect(legacyRoute).toContain("searchParams.get('admin')")
    expect(legacyRoute).toContain('getShopStats(session, shopId, { monthKey, adminId })')

    const rangeRoute = readFileSync(resolve(process.cwd(), range.source), 'utf8')
    expect(rangeRoute).toContain("requireShopPermissionAndFeature('REPORT_VIEW', 'REPORTS')")
    expect(rangeRoute).toContain('if (month && !isMonthKey(month))')
    expect(rangeRoute).toContain('where: { id: adminId, shopId, deletedAt: null }')
    expect(rangeRoute).toContain('getShopReportDataMonths(shopId)')
  })
})
