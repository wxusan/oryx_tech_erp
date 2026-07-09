/**
 * Item 12 — nasiya client trust/rating badge. Shared across the customer
 * list, customer edit dialog, nasiya creation form, and nasiya detail page
 * so the same tier always renders identically everywhere.
 */
'use client'

export type TrustTier = 'NEW' | 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH'
export type TrustColor = 'gray' | 'red' | 'yellow' | 'green' | 'emerald'

export interface TrustBadgeData {
  tier: TrustTier
  label: string
  color: TrustColor
}

const styles: Record<TrustColor, string> = {
  gray: 'bg-zinc-100 text-zinc-500',
  red: 'bg-red-100 text-red-700',
  yellow: 'bg-amber-100 text-amber-700',
  green: 'bg-emerald-100 text-emerald-700',
  emerald: 'bg-emerald-200 text-emerald-800',
}

export function TrustBadge({ trust, className = '' }: { trust: TrustBadgeData; className?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${styles[trust.color]} ${className}`}
    >
      {trust.label}
    </span>
  )
}
