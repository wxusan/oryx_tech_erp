'use client'

import Image from 'next/image'
import { useEffect, useRef, useState, type RefObject } from 'react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'

export interface ImageViewerItem {
  id: string
  src: string
  alt: string
}

export interface ImageViewerController {
  open: boolean
  activeIndex: number
  finalFocusRef: RefObject<HTMLButtonElement | null>
  openAt: (index: number, trigger: HTMLButtonElement) => void
  close: () => void
  onOpenChange: (open: boolean) => void
  onActiveIndexChange: (index: number) => void
}

export function useImageViewer(): ImageViewerController {
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const finalFocusRef = useRef<HTMLButtonElement>(null)

  function openAt(index: number, trigger: HTMLButtonElement) {
    finalFocusRef.current = trigger
    setActiveIndex(index)
    setOpen(true)
  }

  return {
    open,
    activeIndex,
    finalFocusRef,
    openAt,
    close: () => setOpen(false),
    onOpenChange: setOpen,
    onActiveIndexChange: setActiveIndex,
  }
}

export function ImageViewer({
  images,
  open,
  activeIndex,
  onOpenChange,
  onActiveIndexChange,
  finalFocusRef,
  title = 'Rasmni to‘liq ekranda ko‘rish',
}: {
  images: readonly ImageViewerItem[]
  open: boolean
  activeIndex: number
  onOpenChange: (open: boolean) => void
  onActiveIndexChange: (index: number) => void
  finalFocusRef?: RefObject<HTMLElement | null>
  title?: string
}) {
  useEffect(() => {
    if (!open || images.length === 0) return

    function handleKeyDown(event: KeyboardEvent) {
      const currentIndex = Math.min(Math.max(activeIndex, 0), images.length - 1)
      if (event.key === 'ArrowLeft' && currentIndex > 0) {
        event.preventDefault()
        onActiveIndexChange(currentIndex - 1)
      }
      if (event.key === 'ArrowRight' && currentIndex < images.length - 1) {
        event.preventDefault()
        onActiveIndexChange(currentIndex + 1)
      }
    }

    window.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true })
  }, [activeIndex, images.length, onActiveIndexChange, open])

  if (images.length === 0) return null

  const safeIndex = Math.min(Math.max(activeIndex, 0), images.length - 1)
  const activeImage = images[safeIndex]
  const hasPrevious = safeIndex > 0
  const hasNext = safeIndex < images.length - 1

  function navigate(direction: -1 | 1) {
    const nextIndex = safeIndex + direction
    if (nextIndex < 0 || nextIndex >= images.length) return
    onActiveIndexChange(nextIndex)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        finalFocus={finalFocusRef}
        className="fixed inset-0 top-0 left-0 block h-dvh w-screen max-w-none translate-x-0 translate-y-0 gap-0 overflow-hidden rounded-none bg-zinc-950 p-0 text-white ring-0 sm:max-w-none"
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <DialogDescription className="sr-only">
          Escape tugmasi oynani yopadi. Chap va o‘ng tugmalar rasmlar orasida yuradi.
        </DialogDescription>

        <div className="relative h-full w-full bg-zinc-950">
          <Image
            key={activeImage.id}
            src={activeImage.src}
            alt={activeImage.alt}
            fill
            sizes="100vw"
            unoptimized
            className="select-none object-contain"
          />

          {images.length > 1 && (
            <div
              aria-live="polite"
              className="absolute top-[max(0.75rem,env(safe-area-inset-top))] left-1/2 z-10 -translate-x-1/2 rounded-full bg-black/65 px-3 py-1.5 text-sm font-medium text-white"
            >
              {safeIndex + 1} / {images.length}
            </div>
          )}

          <DialogClose
            render={
              <button
                type="button"
                aria-label="Rasm oynasini yopish"
                title="Yopish"
                className="absolute top-[max(0.5rem,env(safe-area-inset-top))] right-[max(0.5rem,env(safe-area-inset-right))] z-20 inline-flex size-11 items-center justify-center rounded-full bg-black/65 text-white transition hover:bg-black/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              />
            }
          >
            <X className="size-6" aria-hidden="true" />
          </DialogClose>

          {hasPrevious && (
            <button
              type="button"
              aria-label="Oldingi rasm"
              title="Oldingi rasm"
              onClick={() => navigate(-1)}
              className="absolute top-1/2 left-[max(0.5rem,env(safe-area-inset-left))] z-20 inline-flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/65 text-white transition hover:bg-black/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <ChevronLeft className="size-7" aria-hidden="true" />
            </button>
          )}

          {hasNext && (
            <button
              type="button"
              aria-label="Keyingi rasm"
              title="Keyingi rasm"
              onClick={() => navigate(1)}
              className="absolute top-1/2 right-[max(0.5rem,env(safe-area-inset-right))] z-20 inline-flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/65 text-white transition hover:bg-black/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <ChevronRight className="size-7" aria-hidden="true" />
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
