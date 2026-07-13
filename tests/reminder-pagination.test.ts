import { describe, expect, it } from 'vitest'
import { processReminderPages } from '@/lib/reminder-pagination'

type Row = { id: string }

const rows: Row[] = Array.from({ length: 250 }, (_, index) => ({
  id: `row-${String(index).padStart(3, '0')}`,
}))

function fetchFrom(input: Row[]) {
  return async (cursor: string | null, take: number) => {
    const start = cursor ? input.findIndex((row) => row.id === cursor) + 1 : 0
    return input.slice(start, start + take)
  }
}

describe('reminder generation pagination', () => {
  it('processes a high-volume result set exactly once in bounded keyset pages', async () => {
    const processed: string[] = []
    const checkpoints: string[] = []

    const result = await processReminderPages({
      initialCursor: null,
      fetchPage: fetchFrom(rows),
      processRow: async (row) => { processed.push(row.id) },
      checkpoint: async (cursor) => { checkpoints.push(cursor) },
      hasTime: () => true,
      pageSize: 100,
    })

    expect(result).toEqual({ complete: true, processed: 250, cursor: 'row-249' })
    expect(processed).toEqual(rows.map((row) => row.id))
    expect(new Set(processed).size).toBe(250)
    expect(checkpoints).toEqual(['row-099', 'row-199', 'row-249'])
  })

  it('resumes after the last fully checkpointed page without a gap or duplicate', async () => {
    const firstRun: string[] = []
    let budgetChecks = 0

    const partial = await processReminderPages({
      initialCursor: null,
      fetchPage: fetchFrom(rows),
      processRow: async (row) => { firstRun.push(row.id) },
      checkpoint: async () => undefined,
      hasTime: () => budgetChecks++ === 0,
      pageSize: 100,
    })

    expect(partial).toEqual({ complete: false, processed: 100, cursor: 'row-099' })

    const resumedRun: string[] = []
    const resumed = await processReminderPages({
      initialCursor: partial.cursor,
      fetchPage: fetchFrom(rows),
      processRow: async (row) => { resumedRun.push(row.id) },
      checkpoint: async () => undefined,
      hasTime: () => true,
      pageSize: 100,
    })

    expect(resumed).toEqual({ complete: true, processed: 150, cursor: 'row-249' })
    expect([...firstRun, ...resumedRun]).toEqual(rows.map((row) => row.id))
    expect(new Set([...firstRun, ...resumedRun]).size).toBe(250)
  })
})
