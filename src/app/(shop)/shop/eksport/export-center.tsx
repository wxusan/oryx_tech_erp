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
  { entity: 'nasiya', permission: 'EXPORT_NASIYA', label: 'Nasiyalar' },
  { entity: 'olib', permission: 'EXPORT_OLIB', label: 'Olib-sotdim' },
  { entity: 'returns', permission: 'EXPORT_RETURNS', label: 'Qaytarishlar' },
  { entity: 'logs', permission: 'EXPORT_LOGS', label: 'Faoliyat tarixi' },
  { entity: 'report', permission: 'EXPORT_REPORTS', label: 'Hisobot' },
] satisfies Array<{ entity: ExportEntity; permission: ShopPermissionCode; label: string }>

export default function ExportCenter() {
  const { can } = useShopAccess()
  const available = exports.filter((item) => can(item.permission))

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
