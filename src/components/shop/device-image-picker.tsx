'use client'

import Image from 'next/image'
import { ImagePlus, X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface DeviceImagePickerProps {
  inputId: string
  previews: string[]
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void
  onRemove: (index: number) => void
  label?: string
  className?: string
}

/** Shared, accessible multi-image picker used by both stock and Olib entry. */
export function DeviceImagePicker({
  inputId,
  previews,
  onChange,
  onRemove,
  label = 'Rasmlar',
  className,
}: DeviceImagePickerProps) {
  const helpId = `${inputId}-help`

  return (
    <fieldset className={cn(className)}>
      <legend className="sr-only">Qurilma rasmlari</legend>
      <div className="mb-2 flex items-center justify-between gap-3">
        <span aria-hidden="true" className="block text-xs font-medium text-zinc-700">{label}</span>
        <label htmlFor={inputId} className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-700 hover:bg-zinc-50">
          <ImagePlus size={14} />
          Rasm tanlash
          <input
            id={inputId}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            onChange={onChange}
            aria-describedby={helpId}
            className="sr-only"
          />
        </label>
      </div>

      {previews.length > 0 ? (
        <div className="grid grid-cols-3 gap-3">
          {previews.map((preview, index) => (
            <div key={`${preview}-${index}`} className="relative aspect-square overflow-hidden rounded border border-zinc-200 bg-zinc-50">
              <Image src={preview} alt={`Qurilma rasmi ${index + 1}`} fill sizes="160px" unoptimized className="object-cover" />
              <button
                type="button"
                aria-label={`${index + 1}-rasmni olib tashlash`}
                onClick={() => onRemove(index)}
                className="absolute right-1.5 top-1.5 inline-flex h-7 w-7 items-center justify-center rounded bg-white/90 text-zinc-700 shadow-sm hover:bg-white hover:text-red-600"
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded border border-dashed border-zinc-200 bg-zinc-50 px-4 py-5 text-center text-xs text-zinc-500">
          Rasm tanlanmagan
        </div>
      )}
      <p id={helpId} className="mt-2 text-xs text-zinc-500">JPG, PNG yoki WEBP, har biri 5 MB gacha</p>
    </fieldset>
  )
}
