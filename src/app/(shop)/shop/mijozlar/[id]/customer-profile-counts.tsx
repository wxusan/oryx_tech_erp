import { CheckCircle2, PackageCheck, RotateCcw, ShoppingBag, Smartphone, WalletCards } from 'lucide-react'
import type { CustomerProfileAnalyticsCounts } from '@/lib/customer-profile-analytics'

export function CustomerProfileCounts({ counts }: { counts: CustomerProfileAnalyticsCounts }) {
  const items = [
    ['Qurilmalar', counts.devices, Smartphone],
    ['Sotuvlar', counts.sales, ShoppingBag],
    ['Nasiyalar', counts.nasiyas, WalletCards],
    ['Faol nasiya', counts.activeNasiyas, PackageCheck],
    ['Yakunlangan', counts.completedNasiyas, CheckCircle2],
    ['Qaytarishlar', counts.returns, RotateCcw],
  ] as const

  return (
    <section aria-labelledby="customer-deal-mix-title" className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
      <h2 id="customer-deal-mix-title" className="text-sm font-semibold text-zinc-950">Mijoz bilan ishlar</h2>
      <div className="mt-3 flex flex-wrap gap-2">
        {items.map(([label, value, Icon]) => (
          <span key={label} className="inline-flex min-h-9 items-center gap-2 rounded-full border border-zinc-200 bg-zinc-50 px-3 text-xs text-zinc-700">
            <Icon className="size-3.5 text-zinc-500" aria-hidden="true" />
            {label} <strong className="font-semibold text-zinc-950">{value}</strong>
          </span>
        ))}
      </div>
    </section>
  )
}
