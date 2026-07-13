import { describe, expect, it } from 'vitest'
import { isLogCategory, logCategoryFor, logCategoryLabel, logCategoryWhere, logCategoryOptions } from '@/lib/log-categories'

describe('log categories', () => {
  it('maps existing actions and target types to shop-facing categories', () => {
    expect(logCategoryFor('IMPORT_NASIYA', 'Nasiya')).toBe('import_nasiya')
    expect(logCategoryFor('SELL', 'Device')).toBe('sale')
    expect(logCategoryFor('PAYMENT', 'Sale')).toBe('payment')
    expect(logCategoryFor('RETURN', 'Device')).toBe('return')
    expect(logCategoryFor('RESTOCK', 'Device')).toBe('device')
    expect(logCategoryFor('CREATE', 'Device')).toBe('device')
    expect(logCategoryFor('UPDATE_TELEGRAM_ID', 'ShopAdmin')).toBe('telegram')
  })

  it('strictly validates category values', () => {
    expect(isLogCategory('nasiya')).toBe(true)
    expect(isLogCategory('nasiya_payment')).toBe(true)
    expect(isLogCategory('sale')).toBe(true)
    expect(isLogCategory('restock')).toBe(false)
    expect(isLogCategory('bad-value')).toBe(false)
    expect(logCategoryLabel('payment')).toBe("Sotuv to'lovlari")
    expect(logCategoryLabel('nasiya_payment')).toBe("Nasiya to'lovlari")
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

// Item 11 — nasiya creation/edit/completion/deferral/reminder actions must be
// a distinct category from nasiya PAYMENT actions, and both distinct from
// sale payments and subscription payments (previously all three were
// silently lumped under one generic "payment"/"To'lovlar" bucket).
describe('item 11: nasiya vs nasiya-payment log separation', () => {
  it('Nasiya creation/completion/reminder actions fall under "nasiya"', () => {
    expect(logCategoryFor('CREATE_NASIYA', 'Nasiya')).toBe('nasiya')
    expect(logCategoryFor('NASIYA_COMPLETED', 'Nasiya')).toBe('nasiya')
    expect(logCategoryFor('UPDATE_REMINDER', 'Nasiya')).toBe('nasiya')
  })

  it('a nasiya schedule PAYMENT action falls under "nasiya_payment", never "nasiya"', () => {
    expect(logCategoryFor('PAYMENT', 'NasiyaSchedule')).toBe('nasiya_payment')
  })

  it('deferring a schedule (NASIYA_DEFER) is a nasiya-management action, not a payment, despite its NasiyaSchedule target', () => {
    expect(logCategoryFor('NASIYA_DEFER', 'NasiyaSchedule')).toBe('nasiya')
  })

  it('a sale PAYMENT action falls under "payment" (sale payments), never "nasiya_payment"', () => {
    expect(logCategoryFor('PAYMENT', 'Sale')).toBe('payment')
  })

  it('a supplier payable action falls under its own "supplier_payment" category', () => {
    expect(logCategoryFor('SUPPLIER_PAYABLE_PAID', 'SupplierPayable')).toBe('supplier_payment')
  })

  it('the filter tabs list separates Nasiya from Nasiya to\'lovlari as distinct options', () => {
    expect(logCategoryWhere('nasiya')).toEqual({
      OR: [
        { targetType: 'Nasiya' },
        { action: 'NASIYA_DEFER', targetType: 'NasiyaSchedule' },
      ],
    })
    expect(logCategoryWhere('nasiya_payment')).toEqual({
      OR: [{ action: 'PAYMENT', targetType: 'NasiyaSchedule' }],
    })
    expect(logCategoryWhere('supplier_payment')).toEqual({
      OR: [{ targetType: 'SupplierPayable' }],
    })
  })

  it('every option in logCategoryOptions has a unique value', () => {
    const values = new Set<string>()
    for (const option of logCategoryOptions) {
      expect(values.has(option.value)).toBe(false)
      values.add(option.value)
    }
  })

  it('does not expose the legacy restock audit category in shop-facing filters', () => {
    expect(logCategoryOptions.some((option) => option.label === 'Qayta sotuv')).toBe(false)
  })
})
