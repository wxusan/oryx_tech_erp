'use client'

import { formatUzPhoneDisplay } from '@/lib/phone'
import type { AdminShopUser } from '@/lib/admin-shop-detail-contract'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

export function ShopAdminsTable({
  admins,
  onAdd,
  onResetPassword,
  onDelete,
}: {
  admins: AdminShopUser[]
  onAdd: () => void
  onResetPassword: (admin: AdminShopUser) => void
  onDelete: (admin: AdminShopUser) => void
}) {
  return (
    <div className="mb-5 border border-zinc-200 bg-white">
      <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4">
        <h2 className="text-sm font-semibold text-zinc-900">Adminlar</h2>
        <button className="border border-zinc-200 px-2.5 py-1 text-xs text-zinc-500 transition-colors hover:bg-zinc-50 hover:text-zinc-900" onClick={onAdd}>+ Admin qo&apos;shish</button>
      </div>
      <Table>
        <TableHeader><TableRow className="border-zinc-200 bg-zinc-50">
          <TableHead className="pl-5 text-xs font-medium text-zinc-500">Ism</TableHead>
          <TableHead className="text-xs font-medium text-zinc-500">Login</TableHead>
          <TableHead className="text-xs font-medium text-zinc-500">Tel</TableHead>
          <TableHead className="text-xs font-medium text-zinc-500">Telegram ID</TableHead>
          <TableHead className="text-xs font-medium text-zinc-500">Holat</TableHead>
          <TableHead className="pr-5 text-right text-xs font-medium text-zinc-500">Amallar</TableHead>
        </TableRow></TableHeader>
        <TableBody>{admins.length === 0 ? (
          <TableRow><TableCell colSpan={6} className="py-8 text-center text-sm text-zinc-400">Admin topilmadi</TableCell></TableRow>
        ) : admins.map((admin) => (
          <TableRow key={admin.id} className="border-zinc-100 hover:bg-zinc-50">
            <TableCell className="pl-5 text-sm font-medium text-zinc-900">{admin.name}</TableCell>
            <TableCell className="font-mono text-sm text-zinc-500">{admin.login}</TableCell>
            <TableCell className="font-mono text-sm text-zinc-500">{formatUzPhoneDisplay(admin.phone)}</TableCell>
            <TableCell className="text-sm text-zinc-500">{admin.telegramVerifiedAt ? <span className="text-emerald-700">Ulangan</span> : admin.telegramId ? 'Tasdiqlanmagan' : '—'}</TableCell>
            <TableCell><span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium ${admin.isActive ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-500'}`}>{admin.isActive ? 'Faol' : 'Nofaol'}</span></TableCell>
            <TableCell className="pr-5 text-right"><div className="flex items-center justify-end gap-1.5">
              <button onClick={() => onResetPassword(admin)} className="border border-zinc-200 px-2 py-1 text-xs text-zinc-500 transition-colors hover:bg-zinc-50 hover:text-zinc-900">Parol</button>
              <button onClick={() => onDelete(admin)} className="border border-red-200 px-2 py-1 text-xs text-red-500 transition-colors hover:bg-red-50 hover:text-red-700">O&apos;chirish</button>
            </div></TableCell>
          </TableRow>
        ))}</TableBody>
      </Table>
    </div>
  )
}
