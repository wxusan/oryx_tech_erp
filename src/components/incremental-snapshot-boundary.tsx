'use client'

import { useEffect } from 'react'
import { adoptIncrementalSnapshotCursor, requestIncrementalSync } from '@/lib/client-sync-runtime'

/** Replays events that raced with an authenticated Server Component snapshot. */
export function IncrementalSnapshotBoundary({ cursor }: { cursor: string }) {
  useEffect(() => {
    adoptIncrementalSnapshotCursor(cursor)
    void requestIncrementalSync()
  }, [cursor])
  return null
}
