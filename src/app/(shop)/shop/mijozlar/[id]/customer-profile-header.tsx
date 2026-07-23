import Link from 'next/link'
import { ArrowLeft, CalendarDays, Phone } from 'lucide-react'
import { TrustBadge } from '@/components/shop/trust-badge'
import { uzDate } from '@/lib/dates'
import { formatUzPhoneDisplay } from '@/lib/phone'
import type { CustomerProfileOverview } from '@/lib/server/customer-profile'

export function CustomerProfileHeader({ overview }: { overview: CustomerProfileOverview }) {
  const { customer, trust } = overview

  return (
    <>
      <Link
        href="/shop/mijozlar"
        className="inline-flex min-h-9 items-center gap-1.5 rounded-md text-sm text-zinc-500 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900"
      >
        <ArrowLeft className="size-4" aria-hidden="true" /> Mijozlarga qaytish
      </Link>

      <header className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
        <div className="border-b border-zinc-100 bg-gradient-to-r from-zinc-950 to-zinc-800 px-4 py-5 text-white sm:px-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-300">Mijoz profili</p>
              <h1 className="mt-1 truncate text-2xl font-bold tracking-tight">{customer.name}</h1>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-zinc-200">
                <span className="inline-flex items-center gap-1.5 font-mono">
                  <Phone className="size-3.5" aria-hidden="true" /> {formatUzPhoneDisplay(customer.phone)}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <CalendarDays className="size-3.5" aria-hidden="true" /> {uzDate(customer.createdAt)} dan beri
                </span>
              </div>
              {customer.additionalPhones.length > 0 && (
                <p className="mt-2 font-mono text-xs text-zinc-300">
                  Qo‘shimcha: {customer.additionalPhones.map(formatUzPhoneDisplay).join(' · ')}
                </p>
              )}
            </div>
            <div className="shrink-0 rounded-lg bg-white p-1 text-zinc-900">
              <TrustBadge trust={trust} />
            </div>
          </div>
        </div>

        {(trust.reasons.length > 0 || customer.note) && (
          <div className="grid gap-4 p-4 sm:grid-cols-2 sm:p-6">
            {trust.reasons.length > 0 && (
              <div>
                <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Ishonch izohi</h2>
                <ul className="mt-2 space-y-1.5 text-sm text-zinc-700">
                  {trust.reasons.map((reason) => <li key={reason}>• {reason}</li>)}
                </ul>
              </div>
            )}
            {customer.note && (
              <div>
                <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Eslatma</h2>
                <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-700">{customer.note}</p>
              </div>
            )}
          </div>
        )}
      </header>
    </>
  )
}
