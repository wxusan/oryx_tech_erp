import { describe, expect, it } from 'vitest'
import { historyStatusLabel } from '@/lib/labels'

describe('customer history status labels', () => {
  it('localizes device and accounting statuses', () => {
    expect(historyStatusLabel('SOLD_NASIYA')).toBe('Nasiyaga sotilgan')
    expect(historyStatusLabel('WRITE_OFF')).toBe('Hisobdan chiqarish')
    expect(historyStatusLabel('WRITTEN_OFF')).toBe('Hisobdan chiqarilgan')
  })

  it('localizes compound Nasiya resolution transitions', () => {
    expect(historyStatusLabel('ACTIVE:ARCHIVED')).toBe('Faol → Arxivlangan')
    expect(historyStatusLabel('WRITTEN_OFF:ACTIVE')).toBe('Hisobdan chiqarilgan → Faol')
  })

  it('never exposes an unknown raw status', () => {
    expect(historyStatusLabel('SOMETHING_NEW')).toBe('Holat noma’lum')
  })
})
