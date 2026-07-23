'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import { Eye, EyeOff, FileImage } from 'lucide-react'
import { AsyncButton } from '@/components/ui/async-button'
import { useShopAccess } from '@/components/shop/shop-access-context'
import { ImageViewer, useImageViewer } from '@/components/ui/image-viewer'
import { ImageViewerTrigger } from '@/components/ui/image-viewer-trigger'

type PassportPhotoCheck = {
  customerId: string
  status: 'available' | 'unavailable'
}

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
  const canReveal = can('CUSTOMER_PASSPORT_REVEAL')
  const canViewPhoto = can('CUSTOMER_PASSPORT_PHOTO_VIEW')
  const [identifier, setIdentifier] = useState<string | null>(null)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [photoCheck, setPhotoCheck] = useState<PassportPhotoCheck | null>(null)
  const [loading, setLoading] = useState<'identifier' | 'image' | null>(null)
  const [error, setError] = useState('')
  const imageViewer = useImageViewer()
  const photoStatus = !hasPassportPhoto
    ? 'unavailable'
    : photoCheck?.customerId === customerId
      ? photoCheck.status
      : 'checking'

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

  // A valid-looking legacy key can still point to a deleted storage object.
  // Check it before rendering a view action, so users never get an unusable
  // "Rasmni ko'rish" button for an absent passport image.
  useEffect(() => {
    if (!hasPassportPhoto || !canViewPhoto) return
    let cancelled = false

    fetch(`/api/customers/${customerId}/passport/image`, { cache: 'no-store' })
      .then(async (response) => {
        const json = await response.json().catch(() => null) as { success?: boolean; data?: { url?: string } } | null
        if (cancelled) return
        setPhotoCheck({
          customerId,
          status: response.ok && json?.success && Boolean(json.data?.url) ? 'available' : 'unavailable',
        })
      })
      .catch(() => {
        if (!cancelled) setPhotoCheck({ customerId, status: 'unavailable' })
      })

    return () => {
      cancelled = true
    }
  }, [canViewPhoto, customerId, hasPassportPhoto])

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
      imageViewer.close()
      setImageUrl(null)
      return
    }
    setLoading('image')
    setError('')
    try {
      const response = await fetch(`/api/customers/${customerId}/passport/image`, { cache: 'no-store' })
      const json = await response.json().catch(() => null) as { success?: boolean; data?: { url?: string }; error?: string } | null
      if (!response.ok || !json?.success || !json.data?.url) {
        setImageUrl(null)
        setPhotoCheck({ customerId, status: 'unavailable' })
        return
      }
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
          <AsyncButton type="button" variant="outline" size="sm" onClick={revealIdentifier} pending={loading === 'identifier'} pendingLabel="Ochilmoqda…">
            {identifier ? <EyeOff className="mr-1.5 size-4" aria-hidden="true" /> : <Eye className="mr-1.5 size-4" aria-hidden="true" />}
            {identifier ? 'Yashirish' : "To'liq ko'rish"}
          </AsyncButton>
        )}
        {photoStatus === 'available' && canViewPhoto && (
          <AsyncButton type="button" variant="outline" size="sm" onClick={showImage} pending={loading === 'image'} pendingLabel="Ochilmoqda…">
            <FileImage className="mr-1.5 size-4" aria-hidden="true" />
            {imageUrl ? 'Rasmni yopish' : "Rasmni ko'rish"}
          </AsyncButton>
        )}
      </div>
      {canViewPhoto && photoStatus === 'checking' && (
        <p className="mt-2 text-xs text-zinc-500">Pasport rasmi tekshirilmoqda…</p>
      )}
      {canViewPhoto && photoStatus === 'unavailable' && (
        <p className="mt-2 text-xs text-zinc-500">Pasport rasmi yuklanmagan</p>
      )}
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
          <ImageViewerTrigger
            label="Mijozning pasport rasmini kattalashtirish"
            onClick={(trigger) => imageViewer.openAt(0, trigger)}
          />
        </div>
      )}
      <ImageViewer
        images={imageUrl ? [{ id: customerId, src: imageUrl, alt: 'Mijozning pasport rasmi' }] : []}
        open={imageViewer.open}
        activeIndex={imageViewer.activeIndex}
        onOpenChange={imageViewer.onOpenChange}
        onActiveIndexChange={imageViewer.onActiveIndexChange}
        finalFocusRef={imageViewer.finalFocusRef}
        title="Mijozning pasport rasmi"
      />
    </section>
  )
}
