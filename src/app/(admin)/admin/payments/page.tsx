'use client'

import { useQuery } from '@tanstack/react-query'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { queryKeys } from '@/lib/query-keys'
import { useAuthenticatedQueryScope } from '@/components/query-scope-context'

interface Payment {
  id: string
  shop: string
  amount: number
  months: number
  method: string
  date: string
  nextPaymentDate: string
  addedBy: string
}

interface ShopPayment {
  id: string
  amount: number | string
  months: number
  paymentMethod: string
  paidAt: string
  recordedById?: string
  recordedBy?: { name: string; login: string } | null
}

interface ShopWithPayments {
  id: string
  name: string
  subscriptionDue: string
  payments?: ShopPayment[]
}

interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
}

const methodStyle: Record<string, string> = {
  Naqd: 'bg-zinc-100 text-zinc-600',
  Karta: 'bg-zinc-900 text-white',
  Bank: 'bg-zinc-200 text-zinc-700',
}

function methodFromEnum(m: string) {
  if (m === 'CASH') return 'Naqd'
  if (m === 'CARD') return 'Karta'
  if (m === 'TRANSFER') return 'Bank'
  return m
}

function formatMoney(n: number) {
  return n.toLocaleString('ru-RU') + " so'm"
}

function formatDate(value: string) {
  return value ? new Date(value).toLocaleDateString('ru-RU') : '—'
}

function monthKey(date: Date) {
  return `${date.getFullYear()}-${date.getMonth()}`
}

export default function PaymentsPage() {
  const scope = useAuthenticatedQueryScope()
  const paymentsQuery = useQuery({
    queryKey: queryKeys.domain(scope, 'adminPayments'),
    queryFn: async ({ signal }) => {
      const response = await fetch('/api/shops', { signal, cache: 'no-store' })
      const json: ApiResponse<ShopWithPayments[]> = await response.json()
      if (!response.ok || !json.success || !json.data) throw new Error(json.error ?? "To'lovlar yuklanmadi")
      return json.data
        .flatMap((shop) =>
          (shop.payments ?? []).map((payment) => ({
              id: payment.id,
              shop: shop.name,
              amount: Number(payment.amount),
              months: payment.months,
              method: methodFromEnum(payment.paymentMethod),
              date: payment.paidAt,
              nextPaymentDate: shop.subscriptionDue,
              addedBy: payment.recordedBy
                ? `${payment.recordedBy.name} (${payment.recordedBy.login})`
                : payment.recordedById
                  ? payment.recordedById.slice(0, 8)
                  : '—',
          })),
        )
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    },
  })
  const payments = paymentsQuery.data ?? []
  const loading = paymentsQuery.isPending && !paymentsQuery.data
  const error = paymentsQuery.error instanceof Error ? paymentsQuery.error.message : null

  const now = new Date()
  const currentMonth = monthKey(now)
  const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const prevMonth = monthKey(prevMonthDate)
  const currentYear = now.getFullYear()
  const thisMonthPayments = payments.filter((p) => monthKey(new Date(p.date)) === currentMonth)
  const prevMonthPayments = payments.filter((p) => monthKey(new Date(p.date)) === prevMonth)
  const yearPayments = payments.filter((p) => new Date(p.date).getFullYear() === currentYear)
  const sum = (rows: Payment[]) => rows.reduce((total, p) => total + p.amount, 0)

  const statCards = [
    { label: "Bu oy jami", value: formatMoney(sum(thisMonthPayments)), sub: `${thisMonthPayments.length} ta to'lov` },
    { label: "O'tgan oy", value: formatMoney(sum(prevMonthPayments)), sub: `${prevMonthPayments.length} ta to'lov` },
    { label: "Yil davomida", value: formatMoney(sum(yearPayments)), sub: `${currentYear}-yil` },
  ]

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-zinc-900">Do&apos;kon to&apos;lovlari</h1>
      </div>

      {error && (
        <div className="mb-4 p-3 border border-red-200 bg-red-50 text-sm text-red-600">
          {error}
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        {statCards.map(({ label, value, sub }) => (
          <div key={label} className="bg-white border border-zinc-200 p-4">
            <div className="text-xs text-zinc-500 mb-2">{label}</div>
            <div className="text-2xl font-bold text-zinc-900 leading-tight">{value}</div>
            <div className="text-xs text-zinc-400 mt-1">{sub}</div>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white border border-zinc-200">
        <div className="px-5 py-4 border-b border-zinc-200 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-900">To&apos;lovlar ro&apos;yxati</h2>
          <span className="text-xs text-zinc-400">{payments.length} ta yozuv</span>
        </div>
        <Table>
          <TableHeader>
            <TableRow className="border-zinc-200 bg-zinc-50">
              <TableHead className="text-xs text-zinc-500 font-medium pl-5">Do&apos;kon</TableHead>
              <TableHead className="text-xs text-zinc-500 font-medium">Miqdor</TableHead>
              <TableHead className="text-xs text-zinc-500 font-medium">Obuna muddati</TableHead>
              <TableHead className="text-xs text-zinc-500 font-medium">To&apos;lov usuli</TableHead>
              <TableHead className="text-xs text-zinc-500 font-medium">To&apos;lov sanasi</TableHead>
              <TableHead className="text-xs text-zinc-500 font-medium">Keyingi to&apos;lov sanasi</TableHead>
              <TableHead className="text-xs text-zinc-500 font-medium pr-5">Kim qo&apos;shgan</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-10 text-sm text-zinc-400">
                  Yuklanmoqda...
                </TableCell>
              </TableRow>
            ) : payments.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-10 text-sm text-zinc-400">
                  To&apos;lovlar topilmadi
                </TableCell>
              </TableRow>
            ) : (
              payments.map((p) => (
                <TableRow key={p.id} className="border-zinc-100 hover:bg-zinc-50">
                  <TableCell className="pl-5 text-sm font-medium text-zinc-900">{p.shop}</TableCell>
                  <TableCell className="text-sm font-semibold text-zinc-800">{formatMoney(p.amount)}</TableCell>
                  <TableCell className="text-sm text-zinc-500">{p.months} oy</TableCell>
                  <TableCell>
                    <span className={[
                      'inline-flex items-center px-2 py-0.5 text-xs font-medium',
                      methodStyle[p.method] ?? 'bg-zinc-100 text-zinc-600',
                    ].join(' ')}>
                      {p.method}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm text-zinc-500">
                    {formatDate(p.date)}
                  </TableCell>
                  <TableCell className="text-sm text-zinc-500">
                    {formatDate(p.nextPaymentDate)}
                  </TableCell>
                  <TableCell className="pr-5 text-xs text-zinc-600">{p.addedBy}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
