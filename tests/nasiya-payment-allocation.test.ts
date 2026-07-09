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
    expect(msg).toContain("2-oyga oldindan qo‘llandi")
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

  it('leads with the contract-currency native amount even when the shop displays a different currency', () => {
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
    // This is a UZS contract (amounts are so‘m), viewed by a USD-display shop.
    // The native contract figure always leads — it's the actual debt — with
    // the display-currency conversion as a "(~...)" hint, never the reverse
    // (see formatContractMoneyWithDisplay / docs/currency-accounting-model.md).
    expect(msg).toContain('$')
    expect(msg).toMatch(/500.?000 so‘m \(~\$40\.00\) joriy oy uchun yopildi/)
    expect(msg).toMatch(/100.?000 so‘m \(~\$8\.00\) 2-oyga oldindan qo‘llandi/)
  })
})

describe('nasiya payment route: chronological allocation, validation, idempotency (source guards)', () => {
  const source = read('src/app/api/nasiya/[id]/payment/route.ts')

  it('sorts overflow allocation by effective due date (oldest unpaid schedule first)', () => {
    expect(source).toContain('leftDue.getTime() - rightDue.getTime() || left.monthNumber - right.monthNumber')
  })

  it('rejects a payment greater than the total outstanding balance — compared in CONTRACT currency (item 4 rate-drift fix), not a legacy-UZS sum', () => {
    expect(source).toContain('if (appliedAmountInContractCurrency > totalOutstandingContract)')
    expect(source).toContain("To'lov qolgan nasiya summasidan oshib ketdi")
    expect(source).toContain('totalContractOutstanding(')
  })

  it('delegates the per-schedule allocation loop to the pure, unit-tested allocateNasiyaPayment (item 4 rate-drift fix)', () => {
    expect(source).toContain("import { allocateNasiyaPayment, totalContractOutstanding } from '@/lib/nasiya-payment-allocation'")
    expect(source).toContain('const scheduleUpdates = allocateNasiyaPayment({')
    expect(source).toContain('for (const scheduleUpdate of scheduleUpdates)')
  })

  it('marks a schedule PAID (with paidAt) only when fully covered per the CONTRACT ledger (item 4 fix — never the legacy UZS ledger alone)', () => {
    expect(source).toContain('paidAt: scheduleUpdate.markPaidAt ? date : null')
    expect(source).toContain('status: scheduleUpdate.status')
  })

  it('is idempotent: a repeated request with the same Idempotency-Key returns the existing payment, no double-allocation', () => {
    expect(source).toContain('existingPayment')
    expect(source).toContain('duplicate: true')
  })

  it('marks the nasiya COMPLETED only on the real transition, guarded by an early block on already-completed nasiyas', () => {
    expect(source).toContain("if (nasiya.status === 'COMPLETED') throw { status: 409, message: 'Bu nasiya yakunlangan' }")
    expect(source).toContain("const justCompleted = newStatus === 'COMPLETED'")
  })

  it('uses the shared, tolerance-aware contractScheduleOutstanding helper instead of duplicated inline math', () => {
    expect(source).toContain("import { calculateRemaining, isScheduleOverdue } from '@/lib/nasiya-utils'")
    expect(source).toContain("import { convertPaymentToContractCurrency, contractScheduleOutstanding } from '@/lib/nasiya-contract'")
    // Completion is decided from the contract-currency ledger (source of
    // truth for debt) — see docs/currency-accounting-model.md.
    expect(source).toContain('const contractAllFullyPaid =')
    expect(source).toContain('contractScheduleOutstanding(Number(s.contractExpectedAmount), Number(s.contractPaidAmount), contractCurrency) <= 0')
  })

  it('passes the per-schedule allocation breakdown (in contract currency) into the Telegram message', () => {
    expect(source).toContain('allocations: allocations.map((a) => ({ monthNumber: a.monthNumber, amount: a.contractAmount }))')
  })
})

describe('cron reminders use per-schedule remaining amount (respects prepayment), not the flat monthly amount', () => {
  it('due-today and overdue reminders compute amountDue from the deal\'s own contract-currency balance (contractScheduleOutstanding), not the legacy UZS snapshot', () => {
    const cron = read('src/app/api/cron/reminders/route.ts')
    expect(cron).toContain('contractScheduleOutstanding(Number(schedule.contractExpectedAmount), Number(schedule.contractPaidAmount), nasiya.contractCurrency)')
    // A fully-prepaid schedule becomes PAID and is excluded from both queries below.
    expect(cron).toContain("status: { in: ['PENDING', 'PARTIAL', 'DEFERRED'] }")
  })
})
