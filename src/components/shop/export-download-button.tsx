'use client'

import { useState } from 'react'
import { AsyncButton, type AsyncButtonProps } from '@/components/ui/async-button'

interface ExportDownloadButtonProps extends Omit<AsyncButtonProps, 'onClick' | 'pending' | 'pendingLabel'> {
  href: string
  fallbackFilename: string
  pendingLabel?: string
}

export function ExportDownloadButton({
  href,
  fallbackFilename,
  pendingLabel = 'Tayyorlanmoqda...',
  children,
  ...buttonProps
}: ExportDownloadButtonProps) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  async function download() {
    setPending(true)
    setError('')
    try {
      const response = await fetch(href, { cache: 'no-store' })
      if (!response.ok) throw new Error('Eksport faylini tayyorlab bo‘lmadi')
      const blob = await response.blob()
      const objectUrl = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      const disposition = response.headers.get('Content-Disposition') ?? ''
      anchor.href = objectUrl
      anchor.download = disposition.match(/filename="?([^";]+)"?/i)?.[1] ?? fallbackFilename
      anchor.click()
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Eksportda xatolik yuz berdi')
    } finally {
      setPending(false)
    }
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <AsyncButton
        {...buttonProps}
        type="button"
        pending={pending}
        pendingLabel={pendingLabel}
        onClick={() => void download()}
      >
        {children}
      </AsyncButton>
      {error && <span role="alert" className="max-w-52 text-right text-xs text-red-600">{error}</span>}
    </span>
  )
}
