import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function read(path: string) {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

describe('nasiya detail first-render performance contract', () => {
  it('keeps the full response compatible while allowing an explicit summary projection', () => {
    const route = read('src/app/api/nasiya/[id]/route.ts')
    expect(route).toContain("const summaryOnly = req.nextUrl.searchParams.get('view') === 'summary'")
    expect(route).toContain('const includePaymentDetails = includePaymentHistory && !summaryOnly')
    expect(route).toContain('const includeCustomerTrustData = includeCustomerTrust && !summaryOnly')
    expect(route).toContain('const includeResolutionEvents = includeResolutionData && !summaryOnly')
    expect(route).toContain('const includePaymentScore = includeProfileData && !summaryOnly')
  })

  it('loads summary, rich history, audit logs, and passport image only on the relevant user intent', () => {
    const detail = read('src/app/(shop)/shop/nasiyalar/[id]/page.tsx')
    const sections = read('src/components/shop/nasiya-history-sections.tsx')
    expect(detail).toContain('fetch(`/api/nasiya/${id}?view=${view}`)')
    expect(detail).toContain("onLoadHistory={() => fetchNasiya('full')}")
    expect(detail).toContain('if (!passportRequested || !canViewPassportPhoto')
    expect(detail).toContain('if (!logsRequested || !canViewLogs || !nasiyaId) return')
    expect(sections).toContain('Batafsil tarixni yuklash')
    expect(sections).toContain('Amallar tarixini yuklash')
  })

  it('patches the open detail screen from confirmed payment and defer response DTOs', () => {
    const detail = read('src/app/(shop)/shop/nasiyalar/[id]/page.tsx')
    const deferRoute = read('src/app/api/nasiya/[id]/defer/route.ts')
    expect(detail).toContain('function applyPaymentResult(receipt: NasiyaPaymentMutationResult)')
    expect(detail).toContain('function applyDeferResult(result: NasiyaDeferMutationResult)')
    expect(detail).toContain('onSuccess={applyPaymentResult}')
    expect(detail).toContain('onSuccess={applyDeferResult}')
    expect(deferRoute).toContain('ledger: {')
    expect(deferRoute).toContain('remaining: postDeferLedger.remaining')
  })
})
