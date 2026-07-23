'use client'

import { Download, FileSpreadsheet } from 'lucide-react'
import { ExportDownloadButton } from '@/components/shop/export-download-button'
import { useShopAccess } from '@/components/shop/shop-access-context'
import { exportUrl, type ExportEntity } from '@/lib/export-url'
import type { ShopPermissionCode } from '@/lib/access-control'

const exports = [
  { entity: 'devices', permission: 'EXPORT_DEVICES', label: 'Qurilmalar' },
  { entity: 'customers', permission: 'EXPORT_CUSTOMERS', label: 'Mijozlar' },
  { entity: 'sales', permission: 'EXPORT_SALES', label: 'Sotuvlar' },
  { entity: 'sale-payments', permission: 'EXPORT_SALES', label: 'Sotuv to‘lovlari daftari', ownerOnly: true },
  { entity: 'nasiya', permission: 'EXPORT_NASIYA', label: 'Nasiyalar' },
  { entity: 'nasiya-schedules', permission: 'EXPORT_NASIYA', label: 'Nasiya jadvallari daftari', ownerOnly: true },
  { entity: 'nasiya-payments', permission: 'EXPORT_NASIYA', label: 'Nasiya to‘lovlari daftari', ownerOnly: true },
  { entity: 'nasiya-payment-allocations', permission: 'EXPORT_NASIYA', label: 'Nasiya to‘lov taqsimotlari', ownerOnly: true },
  { entity: 'olib', permission: 'EXPORT_OLIB', label: 'Olib-sotdim' },
  { entity: 'supplier-payable-payments', permission: 'EXPORT_OLIB', label: 'Yetkazib beruvchi to‘lovlari', ownerOnly: true },
  { entity: 'returns', permission: 'EXPORT_RETURNS', label: 'Qaytarishlar' },
  { entity: 'logs', permission: 'EXPORT_LOGS', label: 'Faoliyat tarixi' },
  { entity: 'report', permission: 'EXPORT_REPORTS', label: 'Hisobot' },
] satisfies Array<{ entity: ExportEntity; permission: ShopPermissionCode; label: string; ownerOnly?: boolean }>

export default function ExportCenter() {
  const { can, memberKind } = useShopAccess()
  const available = exports.filter(
    (item) => can(item.permission) && (!item.ownerOnly || memberKind === 'SHOP_OWNER'),
  )

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-6">
      <div>
        <h1 className="text-xl font-bold text-zinc-900">Eksport</h1>
        <p className="mt-1 text-sm text-zinc-500">Ruxsat berilgan ma&apos;lumot fayllari</p>
      </div>

      <div className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 bg-white">
        {available.map((item) => (
          <div key={item.entity} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <FileSpreadsheet className="shrink-0 text-zinc-500" size={20} aria-hidden="true" />
              <span className="truncate text-sm font-medium text-zinc-900">{item.label}</span>
            </div>
            <div className="flex gap-2">
              <ExportDownloadButton
                href={exportUrl(item.entity, 'csv')}
                fallbackFilename={`${item.entity}.csv`}
                variant="outline"
              >
                <Download size={15} aria-hidden="true" /> CSV
              </ExportDownloadButton>
              <ExportDownloadButton
                href={exportUrl(item.entity, 'xlsx')}
                fallbackFilename={`${item.entity}.xlsx`}
              >
                <Download size={15} aria-hidden="true" /> Excel
              </ExportDownloadButton>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
