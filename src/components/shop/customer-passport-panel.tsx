'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import { Eye, EyeOff, FileImage } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useShopAccess } from '@/components/shop/shop-access-context'

export function CustomerPassportPanel({
  customerId,
  passportMasked,
  hasPassportPhoto,
}: {
  customerId: string
  passportMasked: string | null
  hasPassportPhoto: boolean
}) {
  const { can } = useShopAccess()
  const canReveal = can('CUSTOMER_PII_REVEAL')
  const [identifier, setIdentifier] = useState<string | null>(null)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState<'identifier' | 'image' | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!identifier) return
    const timeout = window.setTimeout(() => setIdentifier(null), 30_000)
    const hideOnBackground = () => {
      if (document.visibilityState !== 'visible') setIdentifier(null)
    }
    document.addEventListener('visibilitychange', hideOnBackground)
    return () => {
      window.clearTimeout(timeout)
      document.removeEventListener('visibilitychange', hideOnBackground)
    }
  }, [identifier])

  async function revealIdentifier() {
    if (identifier) {
      setIdentifier(null)
      return
    }
    setLoading('identifier')
    setError('')
    try {
      const response = await fetch(`/api/customers/${customerId}/passport/reveal`, {
        method: 'POST',
        cache: 'no-store',
      })
      const json = await response.json() as { success: boolean; data?: { identifier: string }; error?: string }
      if (!response.ok || !json.success || !json.data) throw new Error(json.error || "Pasport raqamini ochib bo'lmadi")
      setIdentifier(json.data.identifier)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Pasport raqamini ochib bo'lmadi")
    } finally {
      setLoading(null)
    }
  }

  async function showImage() {
    if (imageUrl) {
      setImageUrl(null)
      return
    }
    setLoading('image')
    setError('')
    try {
      const response = await fetch(`/api/customers/${customerId}/passport/image`, { cache: 'no-store' })
      const json = await response.json() as { success: boolean; data?: { url: string }; error?: string }
      if (!response.ok || !json.success || !json.data) throw new Error(json.error || "Pasport rasmini ochib bo'lmadi")
      setImageUrl(json.data.url)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Pasport rasmini ochib bo'lmadi")
    } finally {
      setLoading(null)
    }
  }

  return (
    <section aria-labelledby="customer-passport-title" className="rounded-lg border border-zinc-200 bg-white p-4">
      <h2 id="customer-passport-title" className="text-sm font-semibold text-zinc-900">Pasport</h2>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm text-zinc-700">{identifier ?? passportMasked ?? 'Kiritilmagan'}</span>
        {passportMasked && canReveal && (
          <Button type="button" variant="outline" size="sm" onClick={revealIdentifier} disabled={loading === 'identifier'}>
            {identifier ? <EyeOff className="mr-1.5 size-4" aria-hidden="true" /> : <Eye className="mr-1.5 size-4" aria-hidden="true" />}
            {loading === 'identifier' ? 'Ochilmoqda…' : identifier ? 'Yashirish' : "To'liq ko'rish"}
          </Button>
        )}
        {hasPassportPhoto && (
          <Button type="button" variant="outline" size="sm" onClick={showImage} disabled={loading === 'image'}>
            <FileImage className="mr-1.5 size-4" aria-hidden="true" />
            {loading === 'image' ? 'Ochilmoqda…' : imageUrl ? 'Rasmni yopish' : "Rasmni ko'rish"}
          </Button>
        )}
      </div>
      {identifier && <p className="mt-2 text-xs text-amber-700">30 soniyadan keyin yoki oynadan chiqqanda avtomatik yashiriladi. Amal auditga yozildi.</p>}
      {error && <p role="alert" className="mt-2 text-xs text-red-600">{error}</p>}
      {imageUrl && (
        <div className="relative mt-3 aspect-[4/3] max-h-80 w-full overflow-hidden rounded-md border border-zinc-200 bg-zinc-50">
          <Image
            src={imageUrl}
            alt="Mijozning pasport rasmi"
            fill
            sizes="(max-width: 640px) 100vw, 560px"
            unoptimized
            className="object-contain p-2"
          />
        </div>
      )}
    </section>
  )
}
