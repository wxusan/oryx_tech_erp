import * as React from "react"
import { cn } from "@/lib/utils"

export type DeviceStatus =
  | "IN_STOCK"
  | "SOLD_CASH"
  | "SOLD_NASIYA"
  | "OVERDUE"
  | "ACTIVE"
  | "SUSPENDED"
  | "COMPLETED"

const STATUS_CONFIG: Record<
  DeviceStatus,
  { label: string; className: string }
> = {
  IN_STOCK: {
    label: "Omborda",
    className:
      "bg-zinc-100 text-zinc-700 border-zinc-200",
  },
  SOLD_CASH: {
    label: "Naqd sotildi",
    className:
      "bg-black text-white border-black",
  },
  SOLD_NASIYA: {
    label: "Nasiyada",
    className:
      "bg-zinc-800 text-zinc-100 border-zinc-700",
  },
  OVERDUE: {
    label: "Muddati o'tgan",
    className:
      "bg-red-50 text-red-700 border-red-200",
  },
  ACTIVE: {
    label: "Faol",
    className:
      "bg-zinc-900 text-white border-zinc-900",
  },
  SUSPENDED: {
    label: "To'xtatilgan",
    className:
      "bg-zinc-100 text-zinc-500 border-zinc-200",
  },
  COMPLETED: {
    label: "Yakunlangan",
    className:
      "bg-zinc-100 text-zinc-600 border-zinc-200",
  },
}

interface StatusBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  status: DeviceStatus
}

function StatusBadge({ status, className, ...props }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status]

  return (
    <span
      data-slot="status-badge"
      data-status={status}
      className={cn(
        "inline-flex items-center border px-2 py-0.5 text-xs font-medium tracking-wide",
        config.className,
        className
      )}
      {...props}
    >
      {config.label}
    </span>
  )
}

export { StatusBadge, STATUS_CONFIG }
export type { StatusBadgeProps }
