'use client'

import type { ComponentProps } from 'react'
import { IntentPrefetchLink } from '@/components/intent-prefetch-link'
import { cn } from '@/lib/utils'

type StretchedLinkProps = ComponentProps<typeof IntentPrefetchLink>

/**
 * A real link whose transparent pseudo-element fills the nearest positioned
 * list row or card.  This preserves browser link behaviour (keyboard focus,
 * Cmd/Ctrl-click and opening in a new tab) without turning a non-semantic
 * container into a click handler.  Put any independent buttons/menus above
 * it with `relative z-10`.
 */
export function StretchedLink({ className, ...props }: StretchedLinkProps) {
  return (
    <IntentPrefetchLink
      {...props}
      data-slot="stretched-link"
      className={cn(
        'after:absolute after:inset-0 after:z-0 after:rounded-[inherit] after:content-[\'\'] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-primary focus-visible:after:ring-offset-2',
        className,
      )}
    />
  )
}
