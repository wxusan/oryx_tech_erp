import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function read(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8')
}

describe('authenticated and responsive application shells', () => {
  it('server-seeds authenticated admin identity without a client session fetch', () => {
    const layout = read('src/app/(admin)/layout.tsx')
    const shell = read('src/app/(admin)/admin-layout-client.tsx')
    expect(layout).toContain('await requireApiSession()')
    expect(layout).toContain("guarded.session.user.role !== 'SUPER_ADMIN'")
    expect(layout).toContain('adminName={guarded.session.user.name}')
    expect(shell).not.toContain("fetch('/api/auth/session'")
  })

  it('prevents the shop content column from forcing document-level mobile overflow', () => {
    const shell = read('src/app/(shop)/shop-layout-client.tsx')
    expect(shell).toContain('flex min-w-0 flex-1 flex-col')
    expect(shell).toContain('min-w-0 flex-1 overflow-auto')
    expect(shell).toContain('hidden text-sm font-medium text-zinc-900 sm:inline')
  })
})

describe('route feedback coverage', () => {
  it('has shared accessible loading and retry UI for admin and shop routes', () => {
    expect(read('src/components/route-loading.tsx')).toContain('aria-busy="true"')
    expect(read('src/components/route-error.tsx')).toContain('unstable_retry')
    expect(read('src/app/(admin)/admin/loading.tsx')).toContain('<RouteLoading')
    expect(read('src/app/(admin)/admin/error.tsx')).toContain('export default RouteError')
    expect(read('src/app/(shop)/shop/error.tsx')).toContain('export default RouteError')
  })
})
