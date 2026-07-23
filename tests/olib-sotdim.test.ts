import { describe, expect, it } from 'vitest'
import { createOlibSotdimSchema, markSupplierPayablePaidSchema, recordSupplierPayablePaymentSchema } from '@/lib/validations'

function baseInput(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    model: 'iPhone 13 Pro',
    storage: '256GB',
    storageAmount: 256,
    storageUnit: 'GB',
    conditionCode: 'NEW',
    imei: '351234560012345',
    supplierName: 'Ali aka',
    supplierPhone: '+998901234567',
    purchasePrice: 6_500_000,
    supplierPaidNow: true,
    supplierPaymentMethod: 'CASH',
    customerName: 'Vali Valiyev',
    customerPhone: '+998907654321',
    salePrice: 7_500_000,
    paymentMethod: 'CASH',
    paidFully: true,
    ...overrides,
  }
}

describe('createOlibSotdimSchema', () => {
  it('accepts a valid "paid now" operation', () => {
    const result = createOlibSotdimSchema.safeParse(baseInput())
    expect(result.success).toBe(true)
    if (result.success) expect(result.data).not.toHaveProperty('storage')
  })

  it('requires supplier payment method when supplierPaidNow is true', () => {
    const result = createOlibSotdimSchema.safeParse(
      baseInput({ supplierPaymentMethod: undefined }),
    )
    expect(result.success).toBe(false)
  })

  it('requires supplierDueDate when supplierPaidNow is false', () => {
    const result = createOlibSotdimSchema.safeParse(
      baseInput({ supplierPaidNow: false, supplierPaymentMethod: undefined }),
    )
    expect(result.success).toBe(false)
  })

  it('accepts "pay later" with a due date', () => {
    const result = createOlibSotdimSchema.safeParse(
      baseInput({
        supplierPaidNow: false,
        supplierPaymentMethod: undefined,
        supplierDueDate: new Date('2026-08-01'),
      }),
    )
    expect(result.success).toBe(true)
  })

  it('accepts the Nasiya outcome with the same core terms and passport contract', () => {
    const result = createOlibSotdimSchema.safeParse(baseInput({
      customerDealType: 'NASIYA',
      salePrice: undefined,
      paymentMethod: undefined,
      paidFully: undefined,
      passportPhotoUrl: 'v1.a-b.c_d.e-f',
      totalAmount: 8_000_000,
      downPayment: 1_000_000,
      months: 7,
      interestPercent: 12,
      startDate: new Date('2026-08-01'),
      nasiyaPaymentMethod: 'CASH',
    }))
    expect(result.success).toBe(true)
  })

  it('rejects incomplete Nasiya terms and a new Nasiya customer without passport evidence', () => {
    expect(createOlibSotdimSchema.safeParse(baseInput({
      customerDealType: 'NASIYA',
      salePrice: undefined,
      paymentMethod: undefined,
      paidFully: undefined,
    })).success).toBe(false)
    expect(createOlibSotdimSchema.safeParse(baseInput({
      customerDealType: 'NASIYA',
      salePrice: undefined,
      paymentMethod: undefined,
      paidFully: undefined,
      totalAmount: 8_000_000,
      downPayment: 1_000_000,
      months: 7,
      startDate: new Date('2026-08-01'),
      nasiyaPaymentMethod: 'CASH',
    })).success).toBe(false)
  })

  it('keeps supplier settlement independent and forbids a fake Pay Later with no remaining liability', () => {
    expect(createOlibSotdimSchema.safeParse(baseInput({
      supplierPaidNow: false,
      supplierDueDate: new Date('2026-08-01'),
      supplierInitialPaymentAmount: 6_500_000,
      supplierPaymentMethod: 'CARD',
    })).success).toBe(false)
    expect(createOlibSotdimSchema.safeParse(baseInput({
      supplierPaidNow: false,
      supplierDueDate: new Date('2026-08-01'),
      supplierInitialPaymentAmount: 1_000_000,
      supplierPaymentMethod: 'CARD',
    })).success).toBe(true)
  })

  it('requires early-reminder days for an open customer Sale reminder', () => {
    expect(createOlibSotdimSchema.safeParse(baseInput({
      paidFully: false,
      amountPaid: 0,
      paymentMethod: undefined,
      dueDate: new Date('2026-08-15'),
      customerReminderEnabled: true,
      customerEarlyReminderEnabled: true,
    })).success).toBe(false)
  })

  it('requires a primary IMEI for every newly recorded device', () => {
    const result = createOlibSotdimSchema.safeParse(baseInput({ imei: undefined }))
    expect(result.success).toBe(false)
  })

  it('accepts a distinct optional secondary IMEI and rejects cross-slot duplicates', () => {
    expect(createOlibSotdimSchema.safeParse(baseInput({ secondaryImei: '351234560012346' })).success).toBe(true)
    expect(createOlibSotdimSchema.safeParse(baseInput({ secondaryImei: '351234560012345' })).success).toBe(false)
  })

  it('requires earlyReminderDays when earlyReminderEnabled is true', () => {
    const result = createOlibSotdimSchema.safeParse(
      baseInput({
        supplierPaidNow: false,
        supplierPaymentMethod: undefined,
        supplierDueDate: new Date('2026-08-01'),
        earlyReminderEnabled: true,
      }),
    )
    expect(result.success).toBe(false)
  })

  it('rejects earlyReminderDays out of the 1-60 bound', () => {
    const result = createOlibSotdimSchema.safeParse(
      baseInput({
        supplierPaidNow: false,
        supplierPaymentMethod: undefined,
        supplierDueDate: new Date('2026-08-01'),
        earlyReminderEnabled: true,
        earlyReminderDays: 90,
      }),
    )
    expect(result.success).toBe(false)
  })

  it('requires amountPaid when paidFully is false', () => {
    const result = createOlibSotdimSchema.safeParse(baseInput({ paidFully: false }))
    expect(result.success).toBe(false)
  })

  it('accepts a customer who pays the entire sale later with zero paid now', () => {
    const result = createOlibSotdimSchema.safeParse(baseInput({
      paidFully: false,
      amountPaid: 0,
      paymentMethod: undefined,
      dueDate: new Date('2026-08-15'),
    }))
    expect(result.success).toBe(true)
  })

  it('allows sale price lower than purchase price (warning is UI-only, not a hard block)', () => {
    const result = createOlibSotdimSchema.safeParse(baseInput({ salePrice: 5_000_000 }))
    expect(result.success).toBe(true)
  })

  it('rejects an invalid supplier or customer phone', () => {
    expect(createOlibSotdimSchema.safeParse(baseInput({ supplierPhone: '123' })).success).toBe(false)
    expect(createOlibSotdimSchema.safeParse(baseInput({ customerPhone: '123' })).success).toBe(false)
  })

  it('requires model, supplierName, customerName', () => {
    expect(createOlibSotdimSchema.safeParse(baseInput({ model: '' })).success).toBe(false)
    expect(createOlibSotdimSchema.safeParse(baseInput({ supplierName: 'A' })).success).toBe(false)
    expect(createOlibSotdimSchema.safeParse(baseInput({ customerName: 'A' })).success).toBe(false)
  })

  it('requires positive purchasePrice and salePrice', () => {
    expect(createOlibSotdimSchema.safeParse(baseInput({ purchasePrice: 0 })).success).toBe(false)
    expect(createOlibSotdimSchema.safeParse(baseInput({ salePrice: -1 })).success).toBe(false)
  })
})

describe('markSupplierPayablePaidSchema', () => {
  it('requires a payment method', () => {
    expect(markSupplierPayablePaidSchema.safeParse({}).success).toBe(false)
    expect(markSupplierPayablePaidSchema.safeParse({ paymentMethod: 'CASH' }).success).toBe(true)
  })
})

describe('recordSupplierPayablePaymentSchema', () => {
  it('accepts partial/full payment commands and rejects non-positive money', () => {
    expect(recordSupplierPayablePaymentSchema.safeParse({ amount: 250_000, paymentMethod: 'CASH' }).success).toBe(true)
    expect(recordSupplierPayablePaymentSchema.safeParse({ amount: 0, paymentMethod: 'CASH' }).success).toBe(false)
    expect(recordSupplierPayablePaymentSchema.safeParse({ amount: -1, paymentMethod: 'CASH' }).success).toBe(false)
  })
})
