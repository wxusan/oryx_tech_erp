import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function read(path: string) {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

describe('shop route feedback coverage', () => {
  it('has an accessible generic loader and page-shaped high-pain loaders', () => {
    const routeLoading = read('src/components/route-loading.tsx')
    expect(routeLoading).toContain('role="status"')
    expect(routeLoading).toContain('aria-live="polite"')
    for (const path of [
      'src/app/(shop)/shop/loading.tsx',
      'src/app/(shop)/shop/sotuvlar/loading.tsx',
      'src/app/(shop)/shop/tolovlar/loading.tsx',
      'src/app/(shop)/shop/mijozlar/loading.tsx',
      'src/app/(shop)/shop/xodimlar/loading.tsx',
      'src/app/(shop)/shop/settings/loading.tsx',
      'src/app/(shop)/shop/import/loading.tsx',
      'src/app/(shop)/shop/eksport/loading.tsx',
      'src/app/(shop)/shop/qurilmalar/new/loading.tsx',
      'src/app/(shop)/shop/qurilmalar/[id]/loading.tsx',
      'src/app/(shop)/shop/nasiyalar/new/loading.tsx',
      'src/app/(shop)/shop/nasiyalar/import/loading.tsx',
      'src/app/(shop)/shop/nasiyalar/[id]/loading.tsx',
      'src/app/(shop)/shop/sotuv/new/loading.tsx',
      'src/app/(shop)/shop/olib-sotdim/loading.tsx',
      'src/app/(shop)/shop/olib-sotdim/new/loading.tsx',
      'src/app/(shop)/shop/qaytarish/loading.tsx',
      'src/app/(shop)/shop/yangi-operatsiya/loading.tsx',
    ]) expect(existsSync(resolve(process.cwd(), path))).toBe(true)
  })

  it('uses useLinkStatus without disabling route prefetch', () => {
    expect(read('src/components/navigation-link-status.tsx')).toContain('useLinkStatus')
    const shell = read('src/app/(shop)/shop-layout-client.tsx')
    expect(shell).toContain('<NavigationLinkStatus')
    expect(shell).not.toContain('prefetch={false}')
  })
})

describe('bounded Sales list architecture', () => {
  const query = read('src/lib/server/sales-list.ts')
  const client = read('src/app/(shop)/shop/sotuvlar/sales-work-queue.tsx')

  it('starts from Sale, applies lifecycle filters, and uses take + 1 without count', () => {
    expect(query).toContain('prisma.sale.findMany')
    expect(query).toContain('deletedAt: null')
    expect(query).toContain('returnedAt: null')
    expect(query).toContain('take: take + 1')
    expect(query).not.toContain('prisma.sale.count')
  })

  it('uses abortable debounced live search with retained rows and no search button', () => {
    expect(client).toContain('DEBOUNCE_MS = 275')
    expect(client).toContain('queryFn: async ({ signal })')
    expect(client).toContain('placeholderData: keepPreviousData')
    expect(client).toContain('<QueryActivity')
    expect(client).not.toContain('Qidirish</Button>')
  })
})

describe('private customer live search', () => {
  const client = read('src/app/(shop)/shop/mijozlar/customers-client.tsx')

  it('keeps search text out of URL and query metadata', () => {
    expect(client).toContain('SEARCH_DEBOUNCE_MS = 275')
    expect(client).toContain('requestRevision: searchRevision')
    expect(client).toContain('customerSearchRequest({')
    expect(client).toContain('replaceListUrlState({ q: null, page')
    expect(client).not.toContain('replaceListUrlState({ q: search')
    expect(client).not.toContain('search: debouncedSearch,\n      page')
    expect(client).not.toContain('Qidirish</Button>')
  })
})

describe('request-floor protections', () => {
  it('deploys application functions beside the AP-South data source', () => {
    const deployment = JSON.parse(read('vercel.json')) as { regions?: string[] }
    expect(deployment.regions).toEqual(['bom1'])
  })

  it('parallelizes authorization lookups and emits privacy-safe server timings', () => {
    expect(read('src/lib/api-auth.ts')).toContain('Promise.all([')
    expect(read('src/lib/api-helpers.ts')).toContain("response.headers.set('Server-Timing'")
    expect(read('src/lib/server/sales-list.ts')).toContain("timeRequestPhase('database'")
    expect(read('src/lib/server/sales-list.ts')).toContain("timeRequestPhaseSync('dto'")
    expect(read('src/lib/server/customer-list.ts')).toContain("timeRequestPhase('database'")
    expect(read('src/app/api/logs/route.ts')).toContain("timeRequestPhaseSync('dto'")
  })

  it('uses stored currency stale-while-revalidate and a hard external timeout', () => {
    const currency = read('src/lib/server/currency.ts')
    expect(currency).toContain('AbortSignal.timeout(CBU_TIMEOUT_MS)')
    expect(currency).toContain("freshness: 'FALLBACK'")
    expect(currency).toContain('after(refresh)')
  })

  it('shares one bounded Prisma pool per production process', () => {
    const prisma = read('src/lib/prisma.ts')
    expect(prisma).toContain('if (globalThis.prisma) return globalThis.prisma')
    expect(prisma).toContain('globalThis.prisma = client')
    expect(prisma).not.toContain("if (process.env.NODE_ENV !== 'production') global.prisma")
  })
})

describe('settings and export completion coverage', () => {
  it('keeps the settings route server-side and seeds a shared client query cache', () => {
    expect(read('src/app/(shop)/shop/settings/page.tsx')).not.toContain("'use client'")
    const client = read('src/app/(shop)/shop/settings/settings-client.tsx')
    expect(client).toContain('useQuery({')
    expect(client).toContain('initialData,')
    for (const section of ['account', 'shop', 'telegram', 'password']) {
      expect(existsSync(resolve(process.cwd(), `src/app/(shop)/shop/settings/settings-${section}-section.tsx`))).toBe(true)
    }
  })

  it('uses a pending-safe request lifecycle for exports', () => {
    const component = read('src/components/shop/export-download-button.tsx')
    expect(component).toContain('<AsyncButton')
    expect(component).toContain('await fetch(href')
    expect(component).toContain('response.blob()')
    for (const path of [
      'src/app/(shop)/shop/qurilmalar/qurilmalar-client.tsx',
      'src/app/(shop)/shop/nasiyalar/nasiyalar-client.tsx',
      'src/app/(shop)/shop/mijozlar/customers-client.tsx',
      'src/app/(shop)/shop/eksport/export-center.tsx',
    ]) expect(read(path)).toContain('<ExportDownloadButton')
  })
})
