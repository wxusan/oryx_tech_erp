import { deviceActionLabel } from '@/lib/device-display'
import { uzDateTime } from '@/lib/dates'

export interface DeviceActionLog {
  id: string
  action: string
  note: string | null
  targetId: string
  targetType: string
  createdAt: string
}

export function DeviceActionHistory({ logs }: { logs: DeviceActionLog[] }) {
  return (
    <section className="overflow-hidden rounded border border-zinc-200" aria-labelledby="device-actions-heading">
      <h2 id="device-actions-heading" className="border-b border-zinc-200 bg-zinc-50 px-4 py-3 text-sm font-semibold text-zinc-900">Amallar tarixi</h2>
      {logs.length ? (
        <ul className="divide-y divide-zinc-100">
          {logs.map((log) => (
            <li key={log.id} className="flex items-start justify-between gap-4 px-4 py-3">
              <div className="min-w-0">
                <div className="text-sm text-zinc-900">{deviceActionLabel(log.action)}</div>
                {log.note && <div className="mt-0.5 text-xs text-zinc-500">{log.note}</div>}
              </div>
              <time dateTime={log.createdAt} className="flex-shrink-0 whitespace-nowrap text-xs text-zinc-400">{uzDateTime(log.createdAt)}</time>
            </li>
          ))}
        </ul>
      ) : (
        <div className="px-4 py-6 text-sm text-zinc-500">Amallar tarixi yo&apos;q</div>
      )}
    </section>
  )
}
