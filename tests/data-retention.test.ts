import { beforeEach, describe, expect, it, vi } from 'vitest'

const executeRaw = vi.hoisted(() => vi.fn())
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: { $executeRaw: executeRaw } }))

import { cleanupRetainedOperationalData, DATA_RETENTION_DAYS } from '@/lib/server/data-retention'

beforeEach(() => {
  vi.clearAllMocks()
  executeRaw
    .mockResolvedValueOnce(11)
    .mockResolvedValueOnce(12)
    .mockResolvedValueOnce(13)
    .mockResolvedValueOnce(14)
})

describe('operational data retention', () => {
  it('uses explicit conservative retention periods', () => {
    expect(DATA_RETENTION_DAYS).toEqual({
      notifications: 90,
      opsEvents: 90,
      closedAuthSessions: 30,
      businessAuditLogs: 2555,
    })
  })

  it('runs one bounded cleanup for each non-ledger table and reports deleted rows', async () => {
    await expect(cleanupRetainedOperationalData(new Date('2026-07-13T00:00:00.000Z'))).resolves.toEqual({
      notifications: 11,
      opsEvents: 12,
      authSessions: 13,
      businessAuditLogs: 14,
    })
    expect(executeRaw).toHaveBeenCalledTimes(4)

    const sql = executeRaw.mock.calls
      .map(([query]) => (Array.isArray(query) ? query.join(' ') : String(query)))
      .join('\n')
    expect(sql).toContain('LIMIT ')
    expect(sql).toContain("status IN ('SENT', 'CANCELLED')")
    expect(sql).toContain('"AuthSession"')
    expect(sql).toContain('"Log"')
    expect(sql).not.toContain('"Sale"')
    expect(sql).not.toContain('"Nasiya"')
    expect(sql).not.toContain('"DeviceReturn"')
  })
})
