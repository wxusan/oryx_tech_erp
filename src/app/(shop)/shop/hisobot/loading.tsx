export default function HisobotLoading() {
  return (
    <div className="space-y-6 p-4 sm:p-6 lg:p-8">
      <div className="h-20 w-full max-w-xl rounded bg-zinc-100" />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={index} className="h-36 rounded-lg border border-zinc-200 bg-zinc-50" />
        ))}
      </div>
      <div className="h-[430px] rounded-xl border border-zinc-200 bg-zinc-50" />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <div className="h-[344px] rounded-lg border border-zinc-200 bg-zinc-50 xl:col-span-3" />
        <div className="h-[344px] rounded-lg border border-zinc-200 bg-zinc-50 xl:col-span-2" />
      </div>
    </div>
  )
}
