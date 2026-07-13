export function SettingsInfo({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-md border border-zinc-200 bg-white p-3">
      <div className="text-xs font-medium text-zinc-500">{label}</div>
      <div className={['mt-1 truncate text-sm font-semibold text-zinc-900', mono ? 'font-mono' : ''].join(' ')}>{value}</div>
    </div>
  )
}
