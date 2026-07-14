'use client'

import { formatUzPhoneDisplay } from '@/lib/phone'
import type { AdminShopUser } from '@/lib/admin-shop-detail-contract'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

export function ShopAdminsTable({
  admins,
  onAdd,
  onResetPassword,
  onDelete,
  canCreateOwner,
}: {
  admins: AdminShopUser[]
  onAdd: () => void
  onResetPassword: (admin: AdminShopUser) => void
  onDelete: (admin: AdminShopUser) => void
  canCreateOwner: boolean
}) {
  return (
    <div className="mb-5 border border-zinc-200 bg-white">
      <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4">
        <h2 className="text-sm font-semibold text-zinc-900">Do&apos;kon profillari</h2>
        <button
          className="border border-zinc-200 px-2.5 py-1 text-xs text-zinc-500 transition-colors hover:bg-zinc-50 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={onAdd}
          disabled={!canCreateOwner}
          title={canCreateOwner ? undefined : "Ega biriktirilgan: xodimlarni faqat do'kon egasi yaratadi"}
        >+ Egani yaratish</button>
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
            <TableCell className="pl-5 text-sm font-medium text-zinc-900">
              <div className="flex flex-wrap items-center gap-2">
                <span>{admin.name}</span>
                <span className={admin.memberKind === 'SHOP_OWNER' ? 'bg-emerald-100 px-1.5 py-0.5 text-[10px] text-emerald-800' : 'bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-600'}>
                  {admin.memberKind === 'SHOP_OWNER' ? 'Egasi' : 'Xodim'}
                </span>
              </div>
            </TableCell>
            <TableCell className="font-mono text-sm text-zinc-500">{admin.login}</TableCell>
            <TableCell className="font-mono text-sm text-zinc-500">{formatUzPhoneDisplay(admin.phone)}</TableCell>
            <TableCell className="text-sm text-zinc-500">{admin.telegramVerifiedAt ? <span className="text-emerald-700">Ulangan</span> : admin.telegramId ? 'Tasdiqlanmagan' : '—'}</TableCell>
            <TableCell><span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium ${admin.isActive ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-500'}`}>{admin.isActive ? 'Faol' : 'Nofaol'}</span></TableCell>
            <TableCell className="pr-5 text-right"><div className="flex items-center justify-end gap-1.5">
              <button onClick={() => onResetPassword(admin)} className="border border-zinc-200 px-2 py-1 text-xs text-zinc-500 transition-colors hover:bg-zinc-50 hover:text-zinc-900">Parol</button>
              {admin.memberKind !== 'SHOP_OWNER' && (
                <button onClick={() => onDelete(admin)} className="border border-red-200 px-2 py-1 text-xs text-red-500 transition-colors hover:bg-red-50 hover:text-red-700">O&apos;chirish</button>
              )}
            </div></TableCell>
          </TableRow>
        ))}</TableBody>
      </Table>
    </div>
  )
}
