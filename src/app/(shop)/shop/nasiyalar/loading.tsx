export default function NasiyalarLoading() {
  return (
    <div className="space-y-4 p-6">
      <div className="h-7 w-36 animate-pulse rounded bg-zinc-100" />
      <div className="flex gap-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-9 w-24 animate-pulse rounded bg-zinc-100" />
        ))}
      </div>
      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="h-24 animate-pulse rounded border border-zinc-200 bg-zinc-50" />
        ))}
      </div>
    </div>
  )
}
