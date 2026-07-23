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

  it('primes and flushes once per bounded page around row processing', async () => {
    const calls: string[] = []
    await processReminderPages({
      initialCursor: null,
      fetchPage: fetchFrom(rows.slice(0, 3)),
      beforePage: async (page) => { calls.push(`prime:${page.length}`) },
      processRow: async (row) => { calls.push(row.id) },
      afterPage: async () => { calls.push('flush') },
      checkpoint: async () => { calls.push('checkpoint') },
      hasTime: () => true,
      pageSize: 2,
    })

    expect(calls).toEqual([
      'prime:2', 'row-000', 'row-001', 'flush', 'checkpoint',
      'prime:1', 'row-002', 'flush', 'checkpoint',
    ])
  })

  it('does not checkpoint a page when a row fails before the page is fully handled', async () => {
    const checkpoints: string[] = []
    const failure = new Error('USD kursi mavjud emas')

    await expect(processReminderPages({
      initialCursor: null,
      fetchPage: fetchFrom(rows.slice(0, 3)),
      processRow: async (row) => {
        if (row.id === 'row-001') throw failure
      },
      checkpoint: async (cursor) => { checkpoints.push(cursor) },
      hasTime: () => true,
      pageSize: 3,
    })).rejects.toBe(failure)

    expect(checkpoints).toEqual([])
  })
})
