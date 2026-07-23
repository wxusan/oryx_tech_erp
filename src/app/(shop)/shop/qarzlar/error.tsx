'use client'

import { Button } from '@/components/ui/button'

export default function QarzlarError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="p-6">
      <div className="max-w-xl rounded-xl border border-red-200 bg-red-50 p-5">
        <h1 className="font-semibold text-red-900">Qarzlar yuklanmadi</h1>
        <p className="mt-1 text-sm text-red-700">Internet aloqasini tekshirib, qayta urinib ko‘ring.</p>
        <Button onClick={reset} className="mt-4">Qayta urinish</Button>
      </div>
    </div>
  )
}
