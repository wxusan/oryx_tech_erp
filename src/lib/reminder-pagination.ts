export const REMINDER_PAGE_SIZE = 100

export interface ReminderPageResult {
  complete: boolean
  processed: number
  cursor: string | null
}

/**
 * Memory-bounded, keyset-paged processing with a durable checkpoint after
 * every fully handled page. If the caller's time budget expires, the saved
 * cursor resumes at the next row; already handled rows remain harmless because
 * reminder writes use unique dedupe keys.
 */
export async function processReminderPages<T extends { id: string }>(input: {
  initialCursor: string | null
  fetchPage: (cursor: string | null, take: number) => Promise<T[]>
  processRow: (row: T) => Promise<void>
  checkpoint: (cursor: string) => Promise<void>
  hasTime: () => boolean
  pageSize?: number
}): Promise<ReminderPageResult> {
  const pageSize = input.pageSize ?? REMINDER_PAGE_SIZE
  let cursor = input.initialCursor
  let processed = 0

  while (input.hasTime()) {
    const page = await input.fetchPage(cursor, pageSize)
    if (page.length === 0) return { complete: true, processed, cursor }

    for (const row of page) {
      await input.processRow(row)
      processed++
    }

    cursor = page[page.length - 1]!.id
    await input.checkpoint(cursor)
    if (page.length < pageSize) return { complete: true, processed, cursor }
  }

  return { complete: false, processed, cursor }
}
