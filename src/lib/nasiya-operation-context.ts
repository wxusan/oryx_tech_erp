import type { CurrencyCode, MoneyDto } from '@/lib/currency'

/**
 * The intentionally small read model used to open payment and deferral
 * dialogs. It must remain free of payment history, customer trust, audit,
 * resolution, and private-document data: those belong to the detail screen.
 */
export interface NasiyaOperationSchedule {
  id: string
  monthNumber: number
  dueDate: string
  delayedUntil: string | null
  status: 'PENDING' | 'PARTIAL' | 'PAID' | 'OVERDUE' | 'DEFERRED' | 'CANCELLED'
  expected: MoneyDto
  paid: MoneyDto
  remaining: MoneyDto
  legacyExpected: MoneyDto
  legacyPaid: MoneyDto
}

export interface NasiyaOperationContext {
  id: string
  customer: { name: string }
  device: { model: string }
  contractCurrency: CurrencyCode
  ledger: {
    remaining: MoneyDto
    status: 'ACTIVE' | 'OVERDUE' | 'COMPLETED' | 'CANCELLED'
    health: 'HEALTHY' | 'REPAIRABLE_PARENT_CACHE' | 'QUARANTINED'
  }
  schedules: NasiyaOperationSchedule[]
}

/** Confirmed mutation fields that can be patched without refetching detail. */
export interface NasiyaOperationLedgerUpdate {
  paid?: MoneyDto
  remaining?: MoneyDto
  status?: NasiyaOperationContext['ledger']['status']
}

export interface NasiyaPaymentMutationResult {
  ledger?: NasiyaOperationLedgerUpdate
  allocations?: Array<{ scheduleId: string; applied: MoneyDto }>
}

export interface NasiyaDeferMutationResult {
  nasiyaScheduleId?: string
  newDueDate?: string
  ledger?: NasiyaOperationLedgerUpdate
}
