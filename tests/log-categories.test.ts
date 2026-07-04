import { describe, expect, it } from 'vitest'
import { isLogCategory, logCategoryFor, logCategoryLabel, logCategoryWhere } from '@/lib/log-categories'

describe('log categories', () => {
  it('maps existing actions and target types to shop-facing categories', () => {
    expect(logCategoryFor('IMPORT_NASIYA', 'Nasiya')).toBe('import_nasiya')
    expect(logCategoryFor('SELL', 'Device')).toBe('sale')
    expect(logCategoryFor('PAYMENT', 'Sale')).toBe('payment')
    expect(logCategoryFor('RETURN', 'Device')).toBe('return')
    expect(logCategoryFor('RESTOCK', 'Device')).toBe('restock')
    expect(logCategoryFor('CREATE', 'Device')).toBe('device')
    expect(logCategoryFor('UPDATE_TELEGRAM_ID', 'ShopAdmin')).toBe('telegram')
  })

  it('strictly validates category values', () => {
    expect(isLogCategory('nasiya')).toBe(true)
    expect(isLogCategory('sale')).toBe(true)
    expect(isLogCategory('bad-value')).toBe(false)
    expect(logCategoryLabel('payment')).toBe("To'lovlar")
  })

  it('builds server-side where filters without leaking undefined fields', () => {
    expect(logCategoryWhere('sale')).toEqual({
      OR: [
        { action: 'SELL', targetType: 'Device' },
        { targetType: 'Sale' },
      ],
    })
    expect(logCategoryWhere('settings')).toEqual({
      OR: [
        { targetType: 'Shop' },
        { action: 'UPDATE_REMINDER' },
      ],
    })
    expect(logCategoryWhere('all')).toEqual({})
  })
})
