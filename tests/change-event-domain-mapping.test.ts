import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { affectedDomainsForChange } from '@/lib/server/change-events'

describe('durable change-event domain mapping', () => {
  it('covers sale and return effects audited under a Device target', () => {
    expect(affectedDomainsForChange('Device', 'devices', 'device.sell')).toEqual(expect.arrayContaining([
      'devices', 'sales', 'customers', 'reports', 'logs', 'overdue',
    ]))
    expect(affectedDomainsForChange('Device', 'devices', 'device.return')).toEqual(expect.arrayContaining([
      'devices', 'sales', 'nasiyas', 'returns', 'reports', 'logs', 'overdue',
    ]))
    expect(affectedDomainsForChange('Device', 'devices', 'device.update')).toEqual(['devices', 'reports', 'logs'])
  })

  it('covers nasiya payments audited under a NasiyaSchedule target', () => {
    expect(affectedDomainsForChange('NasiyaSchedule', 'logs')).toEqual(expect.arrayContaining([
      'devices', 'nasiyas', 'payments', 'customers', 'reports', 'logs', 'overdue',
    ]))
  })

  it('covers olib-sotdim creation audited under a Sale target', () => {
    expect(affectedDomainsForChange('Sale', 'sales')).toContain('olibSotdim')
  })

  it('does not invalidate admin shop caches for a shop-owned settings event', () => {
    expect(affectedDomainsForChange('Shop', 'settings')).toEqual(['settings', 'logs'])
    expect(affectedDomainsForChange('Shop', 'adminShops')).toEqual(expect.arrayContaining([
      'adminShops', 'adminPayments', 'adminReports', 'adminLogs', 'adminOps',
    ]))
  })
})
