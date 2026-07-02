export default function QurilmalarLoading() {
  return (
    <div className="space-y-4 p-6">
      <div className="h-7 w-40 animate-pulse rounded bg-zinc-100" />
      <div className="h-9 w-full max-w-md animate-pulse rounded bg-zinc-100" />
      <div className="rounded border border-zinc-200">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="flex gap-4 border-b border-zinc-100 p-4 last:border-0">
            <div className="h-4 w-32 animate-pulse rounded bg-zinc-100" />
            <div className="h-4 w-24 animate-pulse rounded bg-zinc-100" />
            <div className="h-4 w-28 animate-pulse rounded bg-zinc-100" />
          </div>
        ))}
      </div>
    </div>
  )
}
