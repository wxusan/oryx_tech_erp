'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/button'

export function RouteError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string }
  unstable_retry: () => void
}) {
  useEffect(() => {
    console.error('route render failed', { digest: error.digest, name: error.name })
  }, [error])

  return (
    <div role="alert" className="mx-auto max-w-lg rounded-xl border border-red-200 bg-white p-6 text-center shadow-sm">
      <h2 className="text-lg font-semibold text-zinc-900">Sahifani yuklab bo‘lmadi</h2>
      <p className="mt-2 text-sm text-zinc-500">Vaqtinchalik xatolik yuz berdi. Qayta urinib ko‘ring.</p>
      <Button type="button" onClick={unstable_retry} className="mt-4">Qayta urinish</Button>
    </div>
  )
}
