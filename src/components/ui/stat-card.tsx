import * as React from "react"
import { cn } from "@/lib/utils"

type Trend = "up" | "down" | "neutral"

function TrendIndicator({ trend }: { trend: Trend }) {
  if (trend === "neutral") return null

  return (
    <span
      className={cn(
        "inline-flex items-center text-xs font-medium",
        trend === "up" ? "text-zinc-600" : "text-red-600"
      )}
      aria-label={trend === "up" ? "Oshdi" : "Kamaydi"}
    >
      {trend === "up" ? (
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          aria-hidden
          className="mr-0.5"
        >
          <path d="M5 2L9 8H1L5 2Z" fill="currentColor" />
        </svg>
      ) : (
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          aria-hidden
          className="mr-0.5"
        >
          <path d="M5 8L1 2H9L5 8Z" fill="currentColor" />
        </svg>
      )}
    </span>
  )
}

interface StatCardProps {
  label: string
  value: React.ReactNode
  subtext?: string
  trend?: Trend
  icon?: React.ReactNode
  className?: string
}

function StatCard({
  label,
  value,
  subtext,
  trend,
  icon,
  className,
}: StatCardProps) {
  return (
    <div
      data-slot="stat-card"
      className={cn(
        "flex flex-col gap-3 border border-zinc-200 bg-white p-4",
        className
      )}
    >
      {/* Top row: label + icon */}
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
          {label}
        </span>
        {icon && (
          <span className="flex shrink-0 items-center justify-center text-zinc-300 [&_svg]:size-4">
            {icon}
          </span>
        )}
      </div>

      {/* Value */}
      <div className="flex items-end gap-1.5">
        <span className="text-2xl font-bold tabular-nums leading-none tracking-tight text-zinc-900">
          {value}
        </span>
        {trend && trend !== "neutral" && <TrendIndicator trend={trend} />}
      </div>

      {/* Subtext */}
      {subtext && (
        <p className="text-xs text-zinc-400 leading-snug">{subtext}</p>
      )}
    </div>
  )
}

export { StatCard }
export type { StatCardProps, Trend }
