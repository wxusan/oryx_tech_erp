import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

type DeviceConditionLabel = 'Yangi' | 'B/U' | 'Belgilanmagan'

export function DeviceConditionBadge({ label, className }: { label: DeviceConditionLabel | string; className?: string }) {
  const style = label === 'Yangi'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
    : label === 'B/U'
      ? 'border-amber-200 bg-amber-50 text-amber-800'
      : 'border-zinc-200 bg-zinc-50 text-zinc-600'
  return (
    <Badge variant="outline" aria-label={`Qurilma holati: ${label}`} className={cn(style, className)}>
      {label}
    </Badge>
  )
}
