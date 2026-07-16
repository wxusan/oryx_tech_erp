export function RouteLoading({ label = 'Ma’lumotlar yuklanmoqda' }: { label?: string }) {
  return (
    <div
      className="max-w-7xl animate-pulse space-y-6"
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={label}
    >
      <span className="sr-only">{label}</span>
      <div className="space-y-2">
        <div className="h-7 w-52 rounded bg-zinc-200" />
        <div className="h-4 w-80 max-w-full rounded bg-zinc-100" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-28 rounded-xl border border-zinc-200 bg-white" />
        ))}
      </div>
      <div className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4">
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={index} className="h-12 rounded bg-zinc-100" />
        ))}
      </div>
    </div>
  )
}

export function ListRouteLoading({ label = 'Ro‘yxat yuklanmoqda' }: { label?: string }) {
  return (
    <div
      className="max-w-7xl animate-pulse space-y-5 p-4 sm:p-6"
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={label}
    >
      <span className="sr-only">{label}</span>
      <div className="space-y-2">
        <div className="h-7 w-48 rounded bg-zinc-200" />
        <div className="h-4 w-72 max-w-full rounded bg-zinc-100" />
      </div>
      <div className="flex max-w-xl gap-2">
        <div className="h-9 flex-1 rounded-lg bg-zinc-200" />
        <div className="h-9 w-20 rounded-lg bg-zinc-100" />
      </div>
      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
        <div className="h-11 border-b border-zinc-200 bg-zinc-50" />
        {Array.from({ length: 7 }).map((_, index) => (
          <div key={index} className="h-14 border-b border-zinc-100 last:border-0">
            <div className="mx-4 mt-4 h-4 rounded bg-zinc-100" />
          </div>
        ))}
      </div>
    </div>
  )
}

export function SettingsRouteLoading() {
  return (
    <div
      className="max-w-5xl animate-pulse space-y-6 p-4 sm:p-6"
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label="Sozlamalar yuklanmoqda"
    >
      <span className="sr-only">Sozlamalar yuklanmoqda</span>
      <div className="space-y-2">
        <div className="h-7 w-44 rounded bg-zinc-200" />
        <div className="h-4 w-80 max-w-full rounded bg-zinc-100" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-56 rounded-xl border border-zinc-200 bg-white p-5">
            <div className="h-5 w-32 rounded bg-zinc-200" />
            <div className="mt-6 space-y-4">
              <div className="h-9 rounded bg-zinc-100" />
              <div className="h-9 rounded bg-zinc-100" />
              <div className="h-9 w-28 rounded bg-zinc-200" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function FormRouteLoading({ label = 'Forma yuklanmoqda' }: { label?: string }) {
  return (
    <div
      className="mx-auto max-w-4xl animate-pulse space-y-5 p-4 sm:p-6"
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={label}
    >
      <span className="sr-only">{label}</span>
      <div className="space-y-2">
        <div className="h-7 w-56 rounded bg-zinc-200" />
        <div className="h-4 w-80 max-w-full rounded bg-zinc-100" />
      </div>
      <div className="space-y-5 rounded-xl border border-zinc-200 bg-white p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="space-y-2">
              <div className="h-3 w-24 rounded bg-zinc-100" />
              <div className="h-10 rounded bg-zinc-100" />
            </div>
          ))}
        </div>
        <div className="h-24 rounded bg-zinc-100" />
        <div className="h-10 w-40 rounded bg-zinc-200" />
      </div>
    </div>
  )
}
