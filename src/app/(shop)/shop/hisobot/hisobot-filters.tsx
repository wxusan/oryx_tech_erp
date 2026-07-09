'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface HisobotFiltersProps {
  monthOptions: { value: string; label: string }[]
  selectedMonth: string
  admins: { id: string; name: string }[]
  selectedAdmin: string | null
}

/**
 * Item 8 — month + admin filter for the hisobot page. Navigates via query
 * params (`?month=YYYY-MM&admin=id`) so the server component re-fetches
 * stats for the chosen scope; search/filter resets are just a normal
 * navigation here, no client-side state to go stale.
 */
export default function HisobotFilters({ monthOptions, selectedMonth, admins, selectedAdmin }: HisobotFiltersProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  function navigate(next: { month?: string; admin?: string | null }) {
    const params = new URLSearchParams(searchParams.toString())
    if (next.month !== undefined) params.set('month', next.month)
    if (next.admin !== undefined) {
      if (next.admin) params.set('admin', next.admin)
      else params.delete('admin')
    }
    router.push(`${pathname}?${params.toString()}`)
  }

  return (
    <div className="flex gap-2">
      <Select value={selectedMonth} onValueChange={(month) => month && navigate({ month })}>
        <SelectTrigger className="h-9 w-[140px] text-sm border-zinc-200 rounded bg-white">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {monthOptions.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {admins.length > 0 && (
        <Select value={selectedAdmin ?? 'ALL'} onValueChange={(admin) => navigate({ admin: admin === 'ALL' ? null : admin })}>
          <SelectTrigger className="h-9 w-[160px] text-sm border-zinc-200 rounded bg-white">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Barcha adminlar</SelectItem>
            {admins.map((admin) => (
              <SelectItem key={admin.id} value={admin.id}>
                {admin.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  )
}
