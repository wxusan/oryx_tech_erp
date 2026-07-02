export default function DashboardLoading() {
  return (
    <div className="p-6 space-y-6 max-w-7xl">
      <div className="h-12 w-72 rounded bg-zinc-100" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="h-72 rounded-lg border border-zinc-200 bg-zinc-50 lg:col-span-5" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:col-span-7">
          <div className="h-32 rounded-lg border border-zinc-200 bg-zinc-50" />
          <div className="h-32 rounded-lg border border-zinc-200 bg-zinc-50" />
          <div className="h-32 rounded-lg border border-zinc-200 bg-zinc-50" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-20 rounded-lg border border-zinc-200 bg-zinc-50" />
        ))}
      </div>
    </div>
  )
}
