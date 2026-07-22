import { describe, expect, it } from 'vitest'
import { nasiyaSettlementCompletedMessage } from '@/lib/telegram-templates'

const base = {
  shopName: 'Oryx Mobile',
  customerName: 'Ali Valiyev',
  customerPhone: '+998901234567',
  device: { deviceModel: 'iPhone 15', imei: '123456789012345' },
  adminName: 'Dilshod',
}

describe('nasiyaSettlementCompletedMessage', () => {
  it('separates cash from waived future profit and never calls the waiver paid', () => {
    const message = nasiyaSettlementCompletedMessage({
      ...base,
      mode: 'WAIVE_REMAINING_PROFIT',
      cashReceived: 500_000,
      interestWaived: 100_000,
      contractCurrency: 'UZS',
      reason: 'Mijoz bilan muddatidan oldin yopish kelishuvi',
      currency: { currency: 'UZS', usdUzsRate: null },
    })

    expect(message).toContain('Foydani kechib yopish')
    expect(message).toMatch(/Olingan summa: 500.?000 so‘m/)
    expect(message).toMatch(/Kechilgan kelgusi foyda: 100.?000 so‘m/)
    expect(message).toContain('Qolgan qarz: Yo‘q')
    expect(message).toContain('Mijoz bilan muddatidan oldin yopish kelishuvi')
    expect(message).not.toMatch(/Jami to‘langan[^\n]*600/)
  })

  it('labels a full-profit closure without inventing a waiver line', () => {
    const message = nasiyaSettlementCompletedMessage({
      ...base,
      mode: 'FULL_WITH_PROFIT',
      cashReceived: 600,
      interestWaived: 0,
      contractCurrency: 'USD',
      currency: { currency: 'USD', usdUzsRate: 12_500 },
    })

    expect(message).toContain('Foydasi bilan yopish')
    expect(message).toContain('Olingan summa: $600.00')
    expect(message).not.toContain('Kechilgan kelgusi foyda')
    expect(message).not.toContain('so‘m')
  })
})
