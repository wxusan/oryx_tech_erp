export default function LogsLoading() {
  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div className="h-7 w-24 animate-pulse rounded bg-zinc-100" />
        <div className="h-4 w-20 animate-pulse rounded bg-zinc-100" />
      </div>
      <div className="flex gap-3">
        <div className="h-8 w-72 animate-pulse rounded bg-zinc-100" />
        <div className="h-8 w-36 animate-pulse rounded bg-zinc-100" />
        <div className="h-8 w-36 animate-pulse rounded bg-zinc-100" />
      </div>
      <div className="rounded border border-zinc-200">
        {Array.from({ length: 10 }).map((_, index) => (
          <div key={index} className="grid grid-cols-5 gap-4 border-b border-zinc-100 p-4 last:border-0">
            {Array.from({ length: 5 }).map((__, cellIndex) => (
              <div key={cellIndex} className="h-4 animate-pulse rounded bg-zinc-100" />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
