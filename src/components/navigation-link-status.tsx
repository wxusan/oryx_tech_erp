'use client'

import { useEffect } from 'react'
import { useLinkStatus } from 'next/link'
import { Loader2 } from 'lucide-react'
import { markNavigationFeedback } from '@/lib/client-performance'

export function NavigationLinkStatus({ href }: { href: string }) {
  const { pending } = useLinkStatus()

  useEffect(() => {
    if (pending) markNavigationFeedback(href)
  }, [href, pending])

  return (
    <span className="ml-auto inline-flex size-4 shrink-0 items-center justify-center" aria-hidden="true">
      <Loader2 className={pending ? 'size-3.5 animate-spin opacity-100' : 'size-3.5 opacity-0'} />
    </span>
  )
}
