import { describe, expect, it } from 'vitest'
import {
  addDeviceSchema,
  addSalePaymentSchema,
  createShopSchema,
  importNasiyaSchema,
} from '@/lib/validations'

describe('validation hardening', () => {
  it('rejects arbitrary external device image URLs for new devices', () => {
    const base = {
      model: 'iPhone 15',
      purchasePrice: 10_000_000,
      imei: '123456789012345',
    }

    expect(addDeviceSchema.safeParse({ ...base, imageUrls: ['https://example.com/device.jpg'] }).success).toBe(false)
    expect(addDeviceSchema.safeParse({ ...base, imageUrls: ['shops/shop_1/devices/file.webp'] }).success).toBe(true)
  })

  it('caps long text fields on core create flows', () => {
    expect(createShopSchema.safeParse({
      name: 'A'.repeat(121),
      ownerName: 'Ali',
      ownerPhone: '+998901234567',
      shopNumber: '1',
      admins: [{ name: 'Vali', phone: '+998901234568', login: 'vali', password: 'secret1' }],
    }).success).toBe(false)

    expect(addSalePaymentSchema.safeParse({
      amount: 1000,
      paymentMethod: 'CASH',
      note: 'n'.repeat(1001),
    }).success).toBe(false)
  })

  it('caps imported old nasiya text fields', () => {
    expect(importNasiyaSchema.safeParse({
      customerName: 'Ali',
      customerPhone: '+998901234567',
      deviceModel: 'iPhone',
      imei: '1'.repeat(33),
      originalTotalAmount: 10_000_000,
      alreadyPaidBeforeImport: 2_000_000,
      remainingDebt: 8_000_000,
      monthlyPayment: 1_000_000,
      nextPaymentDate: '2026-08-01',
    }).success).toBe(false)
  })
})
