import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function read(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8')
}

const CUSTOMERS = 'src/app/(shop)/shop/mijozlar/customers-client.tsx'
const CUSTOMER_PROFILE = 'src/app/(shop)/shop/mijozlar/[id]/customer-profile-client.tsx'
const DEVICES = 'src/app/(shop)/shop/qurilmalar/qurilmalar-client.tsx'
const NASIYALAR = 'src/app/(shop)/shop/nasiyalar/nasiyalar-client.tsx'
const OLIB_SOTDIM = 'src/app/(shop)/shop/olib-sotdim/olib-sotdim-client.tsx'
const ADMIN_DASHBOARD = 'src/app/(admin)/admin/page.tsx'
const ADMIN_SHOPS = 'src/app/(admin)/admin/shops/page.tsx'

describe('primary list navigation contract', () => {
  it('uses one shared real-link primitive instead of click-only list containers', () => {
    const primitive = read('src/components/ui/stretched-link.tsx')
    expect(primitive).toContain('IntentPrefetchLink')
    expect(primitive).toContain('after:absolute after:inset-0')
    expect(primitive).toContain('focus-visible:after:ring-2')
  })

  it('makes customer rows/cards directly navigable without placing edit controls inside the link', () => {
    const source = read(CUSTOMERS)
    expect(source).toContain("href={`/shop/mijozlar/${customer.id}`}")
    expect(source).toContain('aria-label={`${customer.name} mijoz profilini ochish`}')
    expect(source).toContain('relative z-10 px-4 py-3 text-right')
    expect(source).toContain('className="relative z-10"')
  })

  it('makes device rows/cards directly navigable and removes redundant Ko\'rish controls', () => {
    const source = read(DEVICES)
    expect(source).toContain("href={`/shop/qurilmalar/${d.id}`}")
    expect(source).toContain('aria-label={`${d.model} qurilmasi ma\'lumotlarini ochish`}')
    expect(source).not.toContain('Ko&apos;rish')
    expect(source).not.toContain('buttonVariants')
  })

  it('makes Nasiya cards directly navigable while payment/defer controls stay above the link', () => {
    const source = read(NASIYALAR)
    expect(source).toContain("href={`/shop/nasiyalar/${n.id}`}")
    expect(source).toContain('aria-label={`${n.customer.name} nasiyasini ochish`}')
    expect(source).toContain('relative z-10 text-right flex-shrink-0 space-y-2')
    expect(source).toContain('className="relative z-10 flex items-center gap-2"')
    expect(source).not.toContain('buttonVariants')
  })

  it('takes Olib-sotdim rows to their underlying device only for users allowed to view it', () => {
    const source = read(OLIB_SOTDIM)
    expect(source).toContain("const canViewDevice = can('INVENTORY_VIEW')")
    expect(source).toContain('href={`/shop/qurilmalar/${row.device.id}`}')
    expect(source).toContain("aria-label={`${row.device.model} qurilmasi ma'lumotlarini ochish`}")
    expect(source).toContain('className="relative z-10 px-4 py-3"')
    expect(source).toContain('render={<Link href="/shop/olib-sotdim/new" />}')
  })

  it('keeps customer-history detail records as full links rather than title-only links', () => {
    const source = read(CUSTOMER_PROFILE)
    expect(source).toContain('<IntentPrefetchLink')
    expect(source).toContain('className="flex flex-col gap-2 p-4 transition-colors')
  })

  it('makes the super-admin shop list clickable without keeping a redundant action column', () => {
    const source = read(ADMIN_SHOPS)
    expect(source).toContain("href={`/admin/shops/${shop.id}`}")
    expect(source).not.toContain('Ko&apos;rish')
    expect(source).not.toContain('>Amallar</TableHead>')
  })

  it('applies the same direct-link contract to the admin dashboard shop list', () => {
    const source = read(ADMIN_DASHBOARD)
    expect(source).toContain("href={`/admin/shops/${shop.id}`}")
    expect(source).not.toContain('Ko&apos;rish')
    expect(source).not.toContain('>Amallar</TableHead>')
  })
})
