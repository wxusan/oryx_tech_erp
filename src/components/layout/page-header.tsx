import * as React from "react"
import { cn } from "@/lib/utils"

interface PageHeaderProps {
  title: string
  subtitle?: string
  actions?: React.ReactNode
  className?: string
}

function PageHeader({ title, subtitle, actions, className }: PageHeaderProps) {
  return (
    <header
      data-slot="page-header"
      className={cn(
        "flex items-start justify-between border-b border-zinc-200 px-6 py-4",
        className
      )}
    >
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-xl font-semibold leading-tight tracking-tight text-zinc-900">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-0.5 text-sm text-zinc-500">{subtitle}</p>
        )}
      </div>

      {actions && (
        <div className="ml-4 flex shrink-0 items-center gap-2">{actions}</div>
      )}
    </header>
  )
}

export { PageHeader }
export type { PageHeaderProps }
