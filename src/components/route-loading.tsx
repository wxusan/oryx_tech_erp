export function RouteLoading({ label = 'Ma’lumotlar yuklanmoqda' }: { label?: string }) {
  return (
    <div className="max-w-7xl animate-pulse space-y-6" aria-busy="true" aria-label={label}>
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
