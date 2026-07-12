import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const route = readFileSync(resolve(process.cwd(), 'src/app/api/stats/due-overdue/route.ts'), 'utf8')

describe('due/overdue summary query bounds', () => {
  it('filters effective nasiya due dates in PostgreSQL', () => {
    expect(route).toContain('{ delayedUntil: { lt: today } }')
    expect(route).toContain('{ delayedUntil: null, dueDate: { lt: today } }')
  })

  it('filters sale due dates in PostgreSQL', () => {
    expect(route).toContain('dueDate: { lt: today }')
  })
})
