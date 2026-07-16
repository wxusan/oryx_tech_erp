import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { nasiyaPaymentMessage } from '@/lib/telegram-templates'

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

const baseData = {
  shopName: 'Test Shop',
  customerName: 'Ali Valiyev',
  customerPhone: '+998901234567',
  device: { deviceModel: 'iPhone 13', imei: '123456789012345' },
  paymentMethod: 'CASH',
  adminName: 'Admin',
  currency: { currency: 'UZS' as const, usdUzsRate: null },
  contractCurrency: 'UZS' as const,
}

describe('nasiyaPaymentMessage — overpayment allocation breakdown', () => {
  it('shows no breakdown for a single-schedule payment (unchanged behavior)', () => {
    const msg = nasiyaPaymentMessage({
      ...baseData,
      month: 1,
      paidAmount: 500_000,
      remaining: 2_000_000,
      allocations: [{ monthNumber: 1, amount: 500_000 }],
    })
    expect(msg).not.toContain('joriy oy uchun yopildi')
    expect(msg).not.toContain('oldindan')
  })

  it('breaks down current-month + prepaid-next-month amounts for an overpayment', () => {
    const msg = nasiyaPaymentMessage({
      ...baseData,
      month: 'MULTIPLE',
      paidAmount: 600_000,
      remaining: 1_900_000,
      allocations: [
        { monthNumber: 1, amount: 500_000 },
        { monthNumber: 2, amount: 100_000 },
      ],
    })
    expect(msg).toMatch(/500.?000/)
    expect(msg).toContain('joriy oy uchun yopildi')
    expect(msg).toMatch(/100.?000/)
    expect(msg).toContain('2-oyga oldindan qo‘llandi')
  })

  it('breaks down a payment spanning three schedules in order', () => {
    const msg = nasiyaPaymentMessage({
      ...baseData,
      month: 'MULTIPLE',
      paidAmount: 1_300_000,
      remaining: 700_000,
      allocations: [
        { monthNumber: 1, amount: 500_000 },
        { monthNumber: 2, amount: 500_000 },
        { monthNumber: 3, amount: 300_000 },
      ],
    })
    const idx1 = msg.indexOf('joriy oy uchun yopildi')
    const idx2 = msg.indexOf('2-oyga oldindan')
    const idx3 = msg.indexOf('3-oyga oldindan')
    expect(idx1).toBeGreaterThan(-1)
    expect(idx2).toBeGreaterThan(idx1)
    expect(idx3).toBeGreaterThan(idx2)
  })

  it('shows only the shop display currency when the contract currency differs', () => {
    const msg = nasiyaPaymentMessage({
      ...baseData,
      month: 'MULTIPLE',
      paidAmount: 600_000,
      remaining: 1_900_000,
      currency: { currency: 'USD', usdUzsRate: 12_500 },
      allocations: [
        { monthNumber: 1, amount: 500_000 },
        { monthNumber: 2, amount: 100_000 },
      ],
    })
    expect(msg).toContain('$')
    expect(msg).not.toContain('so‘m')
    expect(msg).not.toContain('(~')
    expect(msg).toMatch(/\$40\.00 joriy oy uchun yopildi/)
    expect(msg).toMatch(/\$8\.00 2-oyga oldindan qo‘llandi/)
  })
})

describe('nasiya payment route: chronological allocation, validation, idempotency (source guards)', () => {
  const source = read('src/app/api/nasiya/[id]/payment/route.ts')

  it('sorts overflow allocation by effective due date (oldest unpaid schedule first)', () => {
    expect(source).toContain('leftDue.getTime() - rightDue.getTime() || left.monthNumber - right.monthNumber')
  })

  it('rejects a payment greater than the total outstanding balance — compared in CONTRACT currency (item 4 rate-drift fix), not a legacy-UZS sum', () => {
    expect(source).toContain('const totalOutstandingContract = currentLedger.remaining')
    expect(source).toContain('appliedMoney.minorUnits > totalOutstandingContract.minorUnits')
    expect(source).toContain("To'lov qolgan nasiya summasidan oshib ketdi")
    expect(source).toContain('const currentLedger = reconcileNasiyaLedger({')
  })

  it('delegates the per-schedule allocation loop to the pure, unit-tested allocateNasiyaPayment (item 4 rate-drift fix)', () => {
    expect(source).toContain("import { allocateNasiyaPayment } from '@/lib/nasiya-payment-allocation'")
    expect(source).toContain('const scheduleUpdates = allocateNasiyaPayment({')
    expect(source).toContain('for (const [allocationIndex, scheduleUpdate] of scheduleUpdates.entries())')
  })

  it('marks a schedule PAID (with paidAt) only when fully covered per the CONTRACT ledger (item 4 fix — never the legacy UZS ledger alone)', () => {
    expect(source).toContain('paidAt: scheduleUpdate.markPaidAt ? date : null')
    expect(source).toContain('status: scheduleUpdate.status')
  })

  it('is idempotent: a repeated request with the same Idempotency-Key returns the existing payment, no double-allocation', () => {
    expect(source).toContain('existingPayment')
    expect(source).toContain('duplicate: true')
  })

  it('marks the nasiya COMPLETED only on the real contract-status transition, not a raw stored parent label', () => {
    expect(source).toContain("if (currentLedger.status === 'COMPLETED') throw { status: 409, message: 'Bu nasiya yakunlangan' }")
    expect(source).toContain('const postPaymentLedger = reconcileNasiyaLedger({')
    expect(source).toContain("const justCompleted = newStatus === 'COMPLETED'")
  })

  it('uses the shared reconciliation engine instead of duplicated completion or parent-cache math', () => {
    expect(source).toContain("import { moneyDtoDatabaseAmount, reconcileNasiyaLedger } from '@/lib/nasiya-ledger'")
    expect(source).toContain('if (currentLedger.health === \'QUARANTINED\')')
    expect(source).toContain('if (postPaymentLedger.health === \'QUARANTINED\')')
    expect(source).not.toContain('deriveContractNasiyaStatus({')
  })

  it('passes the per-schedule allocation breakdown (in contract currency) into the Telegram message', () => {
    expect(source).toContain('allocations: allocations.map((a) => ({')
    expect(source).toContain('monthNumber: a.monthNumber')
    expect(source).toContain('amount: a.contractAmount')
  })

  it('allows no overpayment beyond the exact minor-unit contract debt', () => {
    expect(source).toContain('appliedMoney.minorUnits > totalOutstandingContract.minorUnits')
    expect(source).not.toContain('isContractCurrencyDust(')
  })
})

describe('cron reminders use per-schedule remaining amount (respects prepayment), not the flat monthly amount', () => {
  it("due-today and overdue reminders use the deal's own stored contract-currency remaining balance, not a recalculated or legacy UZS snapshot", () => {
    const cron = read('src/app/api/cron/reminders/route.ts')
    expect(cron).toContain('amountDue: Number(schedule.contractRemainingAmount)')
    // A fully-prepaid schedule becomes PAID and is excluded from both queries below.
    expect(cron).toContain("status: { not: 'CANCELLED' }")
    expect(cron).toContain('contractRemainingAmount: { gt: 0 }')
  })
})
