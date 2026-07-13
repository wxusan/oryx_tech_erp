import { paymentMethodLabel } from '@/lib/labels'
import type { AdminShopPayment } from '@/lib/admin-shop-detail-contract'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

export function ShopPaymentsTable({ payments }: { payments: AdminShopPayment[] }) {
  return (
    <div className="border border-zinc-200 bg-white">
      <div className="border-b border-zinc-200 px-5 py-4"><h2 className="text-sm font-semibold text-zinc-900">To&apos;lov tarixi</h2></div>
      <Table>
        <TableHeader><TableRow className="border-zinc-200 bg-zinc-50">
          <TableHead className="pl-5 text-xs font-medium text-zinc-500">Sana</TableHead><TableHead className="text-xs font-medium text-zinc-500">Miqdor (so&apos;m)</TableHead><TableHead className="text-xs font-medium text-zinc-500">Oylar</TableHead><TableHead className="text-xs font-medium text-zinc-500">Usul</TableHead>
        </TableRow></TableHeader>
        <TableBody>{payments.length === 0 ? (
          <TableRow><TableCell colSpan={4} className="py-8 text-center text-sm text-zinc-400">To&apos;lovlar tarixi yo&apos;q</TableCell></TableRow>
        ) : payments.map((payment) => (
          <TableRow key={payment.id} className="border-zinc-100 hover:bg-zinc-50">
            <TableCell className="pl-5 text-sm text-zinc-600">{payment.paidAt ? new Date(payment.paidAt).toLocaleDateString('ru-RU') : '—'}</TableCell>
            <TableCell className="text-sm font-medium text-zinc-900">{Number(payment.amount).toLocaleString('ru-RU')} so&apos;m</TableCell>
            <TableCell className="text-sm text-zinc-500">{payment.months} oy</TableCell>
            <TableCell className="text-sm text-zinc-500">{paymentMethodLabel(payment.paymentMethod)}</TableCell>
          </TableRow>
        ))}</TableBody>
      </Table>
    </div>
  )
}
