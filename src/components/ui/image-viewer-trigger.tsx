'use client'

import { Maximize2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export function ImageViewerTrigger({
  label = 'Rasmni kattalashtirish',
  className,
  onClick,
}: {
  label?: string
  className?: string
  onClick: (trigger: HTMLButtonElement) => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(event) => onClick(event.currentTarget)}
      className={cn(
        'absolute top-1 right-1 z-10 inline-flex size-11 items-center justify-center rounded-full text-white outline-none hover:[&>span]:bg-black/85 focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2',
        className,
      )}
    >
      <span className="inline-flex size-8 items-center justify-center rounded-full bg-black/70 shadow-sm transition-colors">
        <Maximize2 className="size-4" aria-hidden="true" />
      </span>
    </button>
  )
}
