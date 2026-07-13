import type { ShopStatus } from '@/lib/domain-types'

const SHOP_STATUS_PRESENTATION: Record<ShopStatus, { label: string; className: string }> = {
  ACTIVE: { label: 'Faol', className: 'bg-zinc-900 text-white' },
  SUSPENDED: { label: "To'xtatilgan", className: 'bg-zinc-100 text-zinc-500' },
  DELETED: { label: "O'chirilgan", className: 'bg-zinc-100 text-zinc-400' },
}

export function ShopStatusBadge({ status }: { status: ShopStatus }) {
  const presentation = SHOP_STATUS_PRESENTATION[status]
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium ${presentation.className}`}>
      {presentation.label}
    </span>
  )
}
