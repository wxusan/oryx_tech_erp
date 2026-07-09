import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

describe('GET /api/nasiya/[id] — contract-authoritative display status', () => {
  const route = read('src/app/api/nasiya/[id]/route.ts')

  it('derives displayStatus/isOverdue/overdueAmount with the same contract helper the list uses', () => {
    expect(route).toContain("import { deriveContractNasiyaStatus } from '@/lib/nasiya-contract-status'")
    expect(route).toContain('const derived = deriveContractNasiyaStatus({')
    expect(route).toContain('contractCurrency: nasiya.contractCurrency')
    expect(route).toContain('contractRemainingAmount: Number(nasiya.contractRemainingAmount)')
    expect(route).toContain('displayStatus: derived.displayStatus,')
    expect(route).toContain('isOverdue: derived.isOverdue,')
    expect(route).toContain('overdueAmount: derived.overdueAmount,')
  })

  it('never mutates financial status as a side effect of a GET', () => {
    expect(route).toContain("import { NextRequest } from 'next/server'")
    expect(route).not.toContain('after(()')
    expect(route).not.toContain('nasiya.self_heal_failed')
    expect(route).not.toContain("data: { remainingAmount: 0, status: 'COMPLETED' }")
  })
})
