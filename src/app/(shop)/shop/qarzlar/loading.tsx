export default function QarzlarLoading() {
  return (
    <div className="space-y-4 p-6" aria-busy="true">
      <div className="h-8 w-48 animate-pulse rounded bg-zinc-200" />
      <div className="h-11 animate-pulse rounded-xl bg-zinc-100" />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => <div key={index} className="h-72 animate-pulse rounded-xl border border-zinc-200 bg-white" />)}
      </div>
    </div>
  )
}
