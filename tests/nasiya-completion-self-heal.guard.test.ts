import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

describe('GET /api/nasiya/[id] — schedule-authoritative display status', () => {
  const route = read('src/app/api/nasiya/[id]/route.ts')

  it('derives financial status from the reconciled schedule projection and applies the immutable return state', () => {
    expect(route).toContain("import { reconcileNasiyaLedger } from '@/lib/nasiya-ledger'")
    expect(route).toContain('const ledger = reconcileNasiyaLedger({')
    expect(route).toContain('contractCurrency: nasiya.contractCurrency')
    expect(route).toContain('const returned = nasiya.returnedAt != null')
    expect(route).toContain("displayStatus: returned ? 'RETURNED' : ledger.status,")
    expect(route).toContain('isOverdue: ledger.isOverdue,')
    expect(route).toContain('overdueAmount: ledger.overdue,')
    expect(route).toContain('ledger,')
  })

  it('never mutates financial status as a side effect of a GET', () => {
    expect(route).toContain("import { NextRequest } from 'next/server'")
    expect(route).not.toContain('after(()')
    expect(route).not.toContain('nasiya.self_heal_failed')
    expect(route).not.toContain("data: { remainingAmount: 0, status: 'COMPLETED' }")
  })
})
