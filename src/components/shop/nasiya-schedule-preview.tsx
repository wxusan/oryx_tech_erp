export interface NasiyaSchedulePreviewRow {
  month: number
  date: string
  amount: number
}

export function NasiyaSchedulePreview({
  rows,
  formatAmount,
}: {
  rows: NasiyaSchedulePreviewRow[]
  formatAmount: (amount: number) => string
}) {
  if (rows.length === 0) return null

  return (
    <div className="overflow-hidden rounded border border-zinc-200">
      <div className="flex items-center justify-between border-b border-zinc-200 bg-zinc-50 px-4 py-3">
        <span className="text-sm font-semibold text-zinc-900">To&apos;lov jadvali</span>
        <span className="text-xs text-zinc-500">{rows.length} oy</span>
      </div>
      <div className="max-h-52 overflow-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">Nasiya to&apos;lov jadvali</caption>
          <thead className="sticky top-0 border-b border-zinc-200 bg-zinc-50">
            <tr>
              {['#', 'Sana', 'Miqdor'].map((heading) => (
                <th key={heading} className="px-4 py-2 text-left text-xs font-semibold text-zinc-500">
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.month} className="border-b border-zinc-100 last:border-0">
                <td className="px-4 py-2 text-zinc-400">{row.month}</td>
                <td className="px-4 py-2 text-zinc-700">{row.date}</td>
                <td className="px-4 py-2 font-medium text-zinc-900">{formatAmount(row.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
