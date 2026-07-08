import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

describe('GET /api/nasiya/[id] — displayStatus + self-heal', () => {
  const route = read('src/app/api/nasiya/[id]/route.ts')

  it('derives displayStatus/isOverdue/overdueAmount with the same shared helper the list uses', () => {
    expect(route).toContain("import { deriveNasiyaOverdue } from '@/lib/nasiya-utils'")
    expect(route).toContain('const derived = deriveNasiyaOverdue({ status: nasiya.status, schedules: scheduleInputs })')
    expect(route).toContain('displayStatus: derived.displayStatus,')
    expect(route).toContain('isOverdue: derived.isOverdue,')
    expect(route).toContain('overdueAmount: derived.overdueAmount,')
  })

  it('opportunistically persists the COMPLETED correction without blocking the response', () => {
    expect(route).toContain("import { NextRequest, after } from 'next/server'")
    const selfHealIdx = route.indexOf("derived.displayStatus === 'COMPLETED'")
    expect(selfHealIdx).toBeGreaterThan(-1)
    const block = route.slice(selfHealIdx, selfHealIdx + 400)
    expect(block).toContain('after(()')
    expect(block).toContain("status: 'COMPLETED'")
    expect(block).toContain('remainingAmount: 0')
  })

  it('only self-heals a nasiya still stored as ACTIVE/OVERDUE, never touches CANCELLED', () => {
    const selfHealIdx = route.indexOf("derived.displayStatus === 'COMPLETED'")
    const block = route.slice(selfHealIdx, selfHealIdx + 400)
    expect(block).toContain("status: { in: ['ACTIVE', 'OVERDUE'] }")
  })

  it('a self-heal failure is caught and logged, never thrown to the client', () => {
    const selfHealIdx = route.indexOf("derived.displayStatus === 'COMPLETED'")
    const block = route.slice(selfHealIdx, selfHealIdx + 500)
    expect(block).toContain('.catch(')
    expect(block).toContain('nasiya.self_heal_failed')
  })
})
