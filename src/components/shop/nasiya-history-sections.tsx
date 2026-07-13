import type { CurrencyContext } from '@/lib/currency'
import { formatUserFacingMoney } from '@/lib/currency'
import { deriveContractScheduleStatus } from '@/lib/nasiya-contract-status'
import { paymentMethodLabel } from '@/lib/labels'
import { paymentAmountDisplay, type NasiyaPaymentDisplayRecord } from '@/lib/payment-history-display'
import { uzDate, uzDateTime } from '@/lib/dates'

export interface NasiyaScheduleRow {
  id: string
  monthNumber: number
  dueDate: string
  delayedUntil: string | null
  expectedAmount: number
  paidAmount: number
  status: 'PENDING' | 'PARTIAL' | 'PAID' | 'OVERDUE' | 'DEFERRED' | 'CANCELLED'
  contractExpectedAmount: number
  contractPaidAmount: number
}

export interface NasiyaActionLog {
  id: string
  action: string
  note: string | null
  targetType: string
  targetId: string
  createdAt: string
  newValue?: { oldDueDate?: string; newDueDate?: string; reminderEnabled?: boolean } | null
}

type RowStatus = 'PAID' | 'PENDING' | 'PARTIAL' | 'OVERDUE' | 'DEFERRED' | 'CANCELLED'

const schedulePresentation: Record<RowStatus, { label: string; className: string }> = {
  PAID: { label: "To'landi", className: 'bg-zinc-900 text-white' },
  PENDING: { label: 'Kutilmoqda', className: 'bg-zinc-100 text-zinc-600' },
  PARTIAL: { label: "Qisman to'landi", className: 'bg-zinc-200 text-zinc-700' },
  OVERDUE: { label: "Muddati o'tgan", className: 'bg-red-100 text-red-700' },
  DEFERRED: { label: "Keyinga o'tkazilgan", className: 'bg-yellow-100 text-yellow-800' },
  CANCELLED: { label: 'Bekor qilingan', className: 'bg-zinc-200 text-zinc-600' },
}

function RowBadge({ status }: { status: RowStatus }) {
  const presentation = schedulePresentation[status]
  return <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${presentation.className}`}>{presentation.label}</span>
}

function logLabel(log: NasiyaActionLog): string {
  if (log.action === 'CREATE_NASIYA') return 'Nasiya yaratildi'
  if (log.action === 'IMPORT_NASIYA') return 'Eski nasiya import qilindi'
  if (log.action === 'PAYMENT') return "To'lov qabul qilindi"
  if (log.action === 'NASIYA_DEFER') return 'Muddat uzaytirildi'
  if (log.action === 'NASIYA_COMPLETED') return 'Nasiya yakunlandi'
  if (log.action === 'UPDATE_REMINDER') {
    if (log.newValue?.reminderEnabled === true) return 'Eslatma yoqildi'
    if (log.newValue?.reminderEnabled === false) return "Eslatma o'chirildi"
    return "Eslatma o'zgartirildi"
  }
  if (log.action === 'UPDATE') return 'Nasiya tahrirlandi'
  if (log.action === 'DELETE') return "O'chirildi"
  if (log.action === 'RETURN') return 'Qaytarildi'
  return log.action
}

function logDetail(log: NasiyaActionLog): string | null {
  if (log.action === 'NASIYA_DEFER' && log.newValue?.oldDueDate && log.newValue?.newDueDate) {
    return `${uzDate(log.newValue.oldDueDate)} → ${uzDate(log.newValue.newDueDate)}`
  }
  return null
}

export function NasiyaHistorySections({
  schedules,
  payments,
  logs,
  contractCurrency,
  currency,
  formatContractAmount,
}: {
  schedules: NasiyaScheduleRow[]
  payments: NasiyaPaymentDisplayRecord[]
  logs: NasiyaActionLog[]
  contractCurrency: 'UZS' | 'USD'
  currency: CurrencyContext
  formatContractAmount: (amount: number) => string
}) {
  const sortedSchedules = schedules.toSorted((a, b) => a.monthNumber - b.monthNumber)

  return (
    <>
      <section className="overflow-hidden rounded border border-zinc-200" aria-labelledby="nasiya-schedule-heading">
        <h2 id="nasiya-schedule-heading" className="border-b border-zinc-200 bg-zinc-50 px-4 py-3 text-sm font-semibold text-zinc-900">To&apos;lov jadvali</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <caption className="sr-only">Nasiya bo&apos;yicha oylik to&apos;lov jadvali</caption>
            <thead className="border-b border-zinc-200"><tr>{['#', 'Sana', 'Miqdor', "To'langan", 'Status'].map((heading) => <th key={heading} className="bg-zinc-50 px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">{heading}</th>)}</tr></thead>
            <tbody>{sortedSchedules.map((row) => {
              const status = deriveContractScheduleStatus(row, contractCurrency).displayStatus
              return <tr key={row.id} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50">
                <td className="px-4 py-3 text-zinc-500">{row.monthNumber}</td><td className="px-4 py-3 text-zinc-700">{uzDate(row.dueDate)}</td>
                <td className="px-4 py-3 font-medium text-zinc-900">{formatContractAmount(row.contractExpectedAmount)}</td><td className="px-4 py-3 text-zinc-700">{formatContractAmount(row.contractPaidAmount)}</td>
                <td className="px-4 py-3"><RowBadge status={status} /></td>
              </tr>
            })}</tbody>
          </table>
        </div>
      </section>

      <section className="overflow-hidden rounded border border-zinc-200" aria-labelledby="nasiya-payments-heading">
        <h2 id="nasiya-payments-heading" className="border-b border-zinc-200 bg-zinc-50 px-4 py-3 text-sm font-semibold text-zinc-900">To&apos;lov tarixi</h2>
        {payments.length ? <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-sm">
          <caption className="sr-only">Nasiya bo&apos;yicha qabul qilingan to&apos;lovlar</caption>
          <thead className="border-b border-zinc-200"><tr>{['Sana', 'Miqdor', 'Usul', 'Izoh'].map((heading) => <th key={heading} className="bg-zinc-50 px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">{heading}</th>)}</tr></thead>
          <tbody>{payments.map((payment) => <tr key={payment.id} className="border-b border-zinc-100 last:border-0">
            <td className="px-4 py-3 text-zinc-700">{uzDate(payment.paidAt)}</td><td className="px-4 py-3 font-medium text-zinc-900">{paymentAmountDisplay(payment, contractCurrency, currency)}</td>
            <td className="px-4 py-3 text-zinc-700">{payment.paymentBreakdown?.length ? <div className="space-y-0.5">{payment.paymentBreakdown.map((part, index) => <div key={index}>{paymentMethodLabel(part.method)}: <span className="font-medium text-zinc-900">{formatUserFacingMoney({ amount: part.amount, amountCurrency: payment.paymentInputCurrency ?? 'UZS', displayCurrency: currency.currency, rate: payment.paymentExchangeRate ?? currency.usdUzsRate })}</span></div>)}</div> : paymentMethodLabel(payment.paymentMethod)}</td>
            <td className="px-4 py-3 text-zinc-500">{payment.note ?? '—'}</td>
          </tr>)}</tbody>
        </table></div> : <div className="px-4 py-6 text-sm text-zinc-500">To&apos;lov tarixi hali yo&apos;q</div>}
      </section>

      <section className="overflow-hidden rounded border border-zinc-200" aria-labelledby="nasiya-actions-heading">
        <h2 id="nasiya-actions-heading" className="border-b border-zinc-200 bg-zinc-50 px-4 py-3 text-sm font-semibold text-zinc-900">Amallar tarixi</h2>
        {logs.length ? <ul className="divide-y divide-zinc-100">{logs.map((log) => {
          const detail = logDetail(log)
          return <li key={log.id} className="flex items-start justify-between gap-4 px-4 py-3"><div className="min-w-0"><div className="text-sm text-zinc-900">{logLabel(log)}</div>{detail && <div className="mt-0.5 text-xs text-zinc-500">{detail}</div>}{log.note && <div className="mt-0.5 text-xs text-zinc-500">{log.note}</div>}</div><time className="flex-shrink-0 whitespace-nowrap text-xs text-zinc-400" dateTime={log.createdAt}>{uzDateTime(log.createdAt)}</time></li>
        })}</ul> : <div className="px-4 py-6 text-sm text-zinc-500">Amallar tarixi yo&apos;q</div>}
      </section>
    </>
  )
}
