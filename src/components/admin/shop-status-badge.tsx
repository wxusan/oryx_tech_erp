import type { ShopStatus } from '@/lib/domain-types'
import { SHOP_STATUS_LABELS } from '@/lib/presentation-labels'

const SHOP_STATUS_PRESENTATION: Record<ShopStatus, { label: string; className: string }> = {
  ACTIVE: { label: SHOP_STATUS_LABELS.ACTIVE, className: 'bg-zinc-900 text-white' },
  SUSPENDED: { label: SHOP_STATUS_LABELS.SUSPENDED, className: 'bg-zinc-100 text-zinc-500' },
  DELETED: { label: SHOP_STATUS_LABELS.DELETED, className: 'bg-zinc-100 text-zinc-400' },
}

export function ShopStatusBadge({ status }: { status: ShopStatus }) {
  const presentation = SHOP_STATUS_PRESENTATION[status]
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium ${presentation.className}`}>
      {presentation.label}
    </span>
  )
}
